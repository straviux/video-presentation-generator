//! Desktop launcher for the Video Presentation Generator.
//!
//! This app is a shell over the existing engine: it does not bundle or copy
//! the engine (the repo clone with `app/` and `render-engine/`). On launch
//! it resolves the engine folder (VPG_ENGINE_DIR env, then the saved
//! setting, then a folder picker), starts `node server.js` from
//! `<engine>/app` when nothing is listening on 127.0.0.1:3210 yet, waits
//! for the server to answer HTTP 200, and navigates the webview to it.
//! A server that was already running is attached to, never killed; only a
//! server this process spawned is terminated on exit.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const SERVER_ADDR: &str = "127.0.0.1:3210";
const SERVER_URL: &str = "http://127.0.0.1:3210/";
const BOOT_TIMEOUT: Duration = Duration::from_secs(30);

// ---------------------------------------------------------------------------
// Boot state (polled by the splash page)
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootState {
    /// One of: booting, needs_engine, starting, ready, error.
    pub status: String,
    /// Human-readable status line for the splash page.
    pub message: String,
    /// True when the splash should offer the engine folder picker.
    pub can_pick: bool,
    /// The resolved engine folder, when known.
    pub engine_dir: Option<String>,
}

impl BootState {
    fn new(status: &str, message: impl Into<String>, can_pick: bool) -> Self {
        BootState {
            status: status.to_string(),
            message: message.into(),
            can_pick,
            engine_dir: None,
        }
    }
}

pub struct AppState {
    boot: Mutex<BootState>,
    child: Mutex<Option<Child>>,
    /// True only when this process spawned the server (and must kill it).
    spawned: Mutex<bool>,
    /// Guards against two boot threads running at once.
    booting: Mutex<bool>,
}

impl AppState {
    fn set_boot(&self, mut next: BootState) {
        if next.engine_dir.is_none() {
            next.engine_dir = self.boot.lock().unwrap().engine_dir.clone();
        }
        *self.boot.lock().unwrap() = next;
    }

    fn snapshot(&self) -> BootState {
        self.boot.lock().unwrap().clone()
    }
}

// ---------------------------------------------------------------------------
// Settings (plain JSON in the Tauri app config dir)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    engine_dir: Option<String>,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    let Some(path) = settings_path(app) else {
        return Settings::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Settings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) {
    let Some(path) = settings_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(&path, raw);
    }
}

// ---------------------------------------------------------------------------
// Engine resolution and validation
// ---------------------------------------------------------------------------

fn valid_engine(dir: &Path) -> bool {
    dir.join("app").join("server.js").is_file() && dir.join("render-engine").is_dir()
}

fn resolve_engine_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(from_env) = std::env::var("VPG_ENGINE_DIR") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    load_settings(app)
        .engine_dir
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| !p.as_os_str().is_empty())
}

// ---------------------------------------------------------------------------
// HTTP probe (plain std TcpStream, no HTTP client dependency)
// ---------------------------------------------------------------------------

fn server_responds() -> bool {
    let Ok(addr) = SERVER_ADDR.parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(600)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let request = format!("GET / HTTP/1.0\r\nHost: {SERVER_ADDR}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    let head = String::from_utf8_lossy(&buf[..n]);
    head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
}

fn node_available() -> bool {
    Command::new("node")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

fn kill_child(state: &AppState) {
    let spawned = *state.spawned.lock().unwrap();
    if !spawned {
        return;
    }
    if let Some(mut child) = state.child.lock().unwrap().take() {
        #[cfg(windows)]
        {
            // Reliable tree kill on Windows: node may have spawned children
            // (render jobs), and Child::kill only takes the direct process.
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.spawned.lock().unwrap() = false;
}

// ---------------------------------------------------------------------------
// Boot sequence (runs on a background thread)
// ---------------------------------------------------------------------------

fn boot(app: AppHandle) {
    let state = app.state::<AppState>();
    {
        let mut booting = state.booting.lock().unwrap();
        if *booting {
            return;
        }
        *booting = true;
    }
    let finish = |state: &AppState| {
        *state.booting.lock().unwrap() = false;
    };

    // 1. Resolve and validate the engine folder.
    let engine_dir = match resolve_engine_dir(&app) {
        Some(dir) if valid_engine(&dir) => dir,
        Some(dir) => {
            let mut next = BootState::new(
                "error",
                format!(
                    "The saved engine folder is not a Video Presentation Generator engine ({}). It needs app/server.js and a render-engine folder. Pick the folder again.",
                    dir.display()
                ),
                true,
            );
            next.engine_dir = Some(dir.display().to_string());
            state.set_boot(next);
            finish(&state);
            return;
        }
        None => {
            state.set_boot(BootState::new(
                "needs_engine",
                "First, point the app at your Video Presentation Generator folder (the clone that contains app and render-engine).",
                true,
            ));
            finish(&state);
            return;
        }
    };
    let engine_str = engine_dir.display().to_string();

    // 2. A server is already listening: attach, do not spawn or kill.
    if server_responds() {
        let mut next = BootState::new("ready", "Connected to the running server.", false);
        next.engine_dir = Some(engine_str.clone());
        state.set_boot(next);
        navigate_to_server(&app);
        finish(&state);
        return;
    }

    // 3. Node must be on PATH before we try to spawn anything.
    if !node_available() {
        let mut next = BootState::new(
            "error",
            "Node.js was not found on PATH. Install Node 24 or newer, then relaunch.",
            false,
        );
        next.engine_dir = Some(engine_str.clone());
        state.set_boot(next);
        finish(&state);
        return;
    }

    // 4. Spawn the engine server. server.js hardcodes port 3210 (it does
    // not read a PORT env var), so it is spawned as-is.
    state.set_boot({
        let mut next = BootState::new("starting", "Starting the Video Presentation Generator server...", false);
        next.engine_dir = Some(engine_str.clone());
        next
    });
    let child = Command::new("node")
        .arg("server.js")
        .current_dir(engine_dir.join("app"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match child {
        Ok(child) => {
            *state.child.lock().unwrap() = Some(child);
            *state.spawned.lock().unwrap() = true;
        }
        Err(e) => {
            let mut next = BootState::new(
                "error",
                format!("Could not start the server with Node ({e}). Check that the engine folder is complete, then retry."),
                true,
            );
            next.engine_dir = Some(engine_str.clone());
            state.set_boot(next);
            finish(&state);
            return;
        }
    }

    // 5. Wait for the server to answer, then navigate.
    let deadline = Instant::now() + BOOT_TIMEOUT;
    loop {
        if server_responds() {
            let mut next = BootState::new("ready", "Server is up.", false);
            next.engine_dir = Some(engine_str.clone());
            state.set_boot(next);
            navigate_to_server(&app);
            finish(&state);
            return;
        }
        // If node exited early (bad engine, port race), stop waiting.
        if let Some(child) = state.child.lock().unwrap().as_mut() {
            if let Ok(Some(_status)) = child.try_wait() {
                break;
            }
        }
        if Instant::now() > deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(400));
    }

    kill_child(&state);
    let mut next = BootState::new(
        "error",
        "The server did not come up in time. Make sure nothing else is stuck on port 3210, then retry.",
        true,
    );
    next.engine_dir = Some(engine_str);
    state.set_boot(next);
    finish(&state);
}

fn navigate_to_server(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(url) = SERVER_URL.parse() {
            let _ = window.navigate(url);
        }
    }
}

fn spawn_boot(app: AppHandle) {
    std::thread::spawn(move || boot(app));
}

// ---------------------------------------------------------------------------
// Commands (the whole splash surface: these three)
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_boot_state(state: State<AppState>) -> BootState {
    state.snapshot()
}

#[tauri::command]
async fn pick_engine_folder(app: AppHandle, state: State<'_, AppState>) -> BootState {
    let picked = app.dialog().file().blocking_pick_folder();
    if let Some(path) = picked {
        if let Ok(dir) = path.into_path() {
            if valid_engine(&dir) {
                let mut settings = load_settings(&app);
                settings.engine_dir = Some(dir.display().to_string());
                save_settings(&app, &settings);
                state.set_boot(BootState::new("booting", "Engine folder saved. Booting...", false));
                spawn_boot(app.clone());
            } else {
                let mut next = BootState::new(
                    "error",
                    format!(
                        "That folder is not a Video Presentation Generator engine ({}). It needs app/server.js and a render-engine folder.",
                        dir.display()
                    ),
                    true,
                );
                next.engine_dir = Some(dir.display().to_string());
                state.set_boot(next);
            }
        }
    }
    state.snapshot()
}

#[tauri::command]
fn retry_boot(app: AppHandle, state: State<AppState>) -> BootState {
    state.set_boot(BootState::new("booting", "Retrying...", false));
    spawn_boot(app);
    state.snapshot()
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            boot: Mutex::new(BootState::new("booting", "Preparing...", false)),
            child: Mutex::new(None),
            spawned: Mutex::new(false),
            booting: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_boot_state,
            pick_engine_folder,
            retry_boot
        ])
        .setup(|app| {
            spawn_boot(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Video Presentation Generator desktop app");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Terminate only a server this process spawned; an attached
            // (pre-existing) server keeps running.
            let state = app_handle.state::<AppState>();
            kill_child(&state);
        }
    });
}

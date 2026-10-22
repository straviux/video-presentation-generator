// Build the Tailwind stylesheet when the tailwindcss package is installed
// (developer machines). On end-user machines the dev dependency may be
// absent; the built public/styles.css is committed to the repo, so in that
// case just use it as-is instead of failing npm start.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(appDir, "node_modules", "tailwindcss", "lib", "cli.js");

if (!existsSync(cli)) {
  console.log("Tailwind not installed; using the committed public/styles.css.");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [cli, "-i", "./src/input.css", "-o", "./public/styles.css"],
  { cwd: appDir, stdio: "inherit" }
);
process.exit(result.status ?? 1);

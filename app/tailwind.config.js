import daisyui from "daisyui";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./public/index.html"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#8b3dff",
          dark: "#7329d6",
          soft: "#f1e8ff",
        },
        ink: "#1e1e26",
        muted: "#6b6b78",
        line: "#e3e3ea",
        canvas: "#f0f0f3",
        danger: "#d92d20",
      },
      fontFamily: {
        sans: ['"Geist"', "system-ui", '"Segoe UI"', "sans-serif"],
      },
    },
  },
  plugins: [daisyui],
  // DaisyUI is used structurally (the Library popup's dialog, badges),
  // not as the app's theme: only the light theme's variables are loaded
  // and its global base styles stay off, so nothing else is restyled.
  // The few variables the used components need are pinned in src/input.css.
  daisyui: {
    themes: ["light"],
    base: false,
    logs: false,
  },
};

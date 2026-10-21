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
  plugins: [],
};

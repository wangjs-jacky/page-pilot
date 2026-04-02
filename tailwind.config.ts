import type { Config } from "tailwindcss"

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0b",
        "bg-elevated": "#131316",
        text: "#e5e5e7",
        "text-muted": "#6b6b76",
        primary: "#00ff88",
        amber: "#ffb800",
        red: "#ff4757",
        blue: "#00d4ff",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "monospace"],
        sans: ["DM Sans", "sans-serif"],
      },
    },
  },
} satisfies Config

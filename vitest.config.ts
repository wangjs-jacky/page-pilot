import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "node_modules/**"],
    },
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.spec.ts", "tests/**/*.test.ts"],
  },
})

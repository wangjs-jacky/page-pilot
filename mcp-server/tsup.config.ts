import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node20",
    splitting: false,
    sourcemap: true,
    clean: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: ["src/bridge-standalone.ts"],
    format: ["esm"],
    target: "node20",
    splitting: false,
    sourcemap: true,
    // 不加 shebang，由 MCP Server 自动拉起
  },
])

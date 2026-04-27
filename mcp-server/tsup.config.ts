import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/create-mcp-server.ts",
      "src/config.ts",
    ],
    format: ["esm"],
    dts: true,
    sourcemap: true,
  },
]);

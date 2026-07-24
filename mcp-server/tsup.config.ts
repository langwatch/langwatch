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
    // Source-only workspace package — must be bundled, not externalized,
    // since the published npm package has no runtime dep on it.
    noExternal: ["@langwatch/handled-error", "@langwatch/ssrf"],
    sourcemap: true,
  },
]);

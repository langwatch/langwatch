import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/create-mcp-server.ts", "src/config.ts"],
    format: ["esm"],
    // No `dts`: the two entries that publish types ship committed
    // `src/*.d.ts` the exports map already names, and `index` is the CLI,
    // which exports nothing. Generating them cost 4.2s of a 6.8s build.
    // Source-only workspace package — must be bundled, not externalized,
    // since the published npm package has no runtime dep on it.
    noExternal: ["@langwatch/handled-error", "@langwatch/redaction", "@langwatch/egress"],
    sourcemap: true,
  },
]);

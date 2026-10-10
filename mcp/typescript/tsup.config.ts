import { defineConfig } from "tsup";

// Source-only workspace packages -- must be bundled, not externalized, since
// the published npm package has no runtime dep on them.
const noExternal = ["@langwatch/handled-error", "@langwatch/redaction", "@langwatch/egress"];

export default defineConfig([
  {
    // The CLI. ESM only: it uses top-level await, which esbuild cannot emit as
    // CJS, and nothing requires it -- `bin` runs it. Built as a SEPARATE config
    // so it shares no chunk with the dual-format library entries below; an
    // ESM-only chunk reached from a `.cjs` would break `require`.
    entry: ["src/index.ts"],
    format: ["esm"],
    noExternal,
    sourcemap: true,
  },
  {
    // The two entries the exports map publishes. Dual format: `import` takes
    // the ESM `.js`, `require` the `.cjs`. The package is `type: module`, so a
    // CJS consumer can only be served by a real `.cjs` -- pointing `require` at
    // the ESM output, as this package did, hands `require()` a module it
    // cannot load.
    entry: ["src/create-mcp-server.ts", "src/config.ts"],
    format: ["esm", "cjs"],
    // No `dts`: these two ship committed `src/*.d.ts` the exports map names.
    // Generating them cost 4.2s of a 6.8s build.
    noExternal,
    sourcemap: true,
  },
]);

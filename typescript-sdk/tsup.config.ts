import { defineConfig } from "tsup";
import packageJson from "./package.json";

// The card/domain-error contract is a source-only workspace package and a
// devDependency, so it must be inlined rather than left as an import the
// published `langwatch` tarball could never resolve.
const noExternal = ["@langwatch/cli-cards"];

// `__CLI_VERSION__` is a bare identifier in src/cli/program.ts.
const define = {
  __CLI_VERSION__: JSON.stringify(packageJson.version),
};

export default defineConfig([
  {
    // Library entries — the published SDK surface (`langwatch`,
    // `langwatch/observability`, …). Dual format + dts, exactly as before.
    //
    // NOTE: no `clean` here — tsup builds the configs of this array
    // CONCURRENTLY, so a clean in either would race the other build's output.
    // The `build` script rm -rf's dist before invoking tsup instead.
    entry: [
      "src/index.ts",
      "src/observability-sdk/index.ts",
      "src/observability-sdk/setup/node/index.ts",
      "src/observability-sdk/instrumentation/langchain/index.ts",
    ],
    splitting: true,
    clean: false,
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    noExternal,
    define,
  },
  {
    // CLI entry — only ever RUN as CJS (package.json `bin` →
    // ./dist/cli/index.js), never imported as a library, so the ESM copy, the
    // dts and the sourcemaps were pure tarball weight. Built as a SEPARATE
    // config object, not another entry above: entries in one build share
    // chunks, and a CJS-only entry must not share chunks with dual-format
    // library entries (an ESM-only shared chunk would break `require`).
    //
    // `splitting: false` inlines the lazy command chunks into the single
    // file — dynamic `import()` calls keep their lazy semantics (esbuild
    // wraps them in promises), which is what keeps command modules and the
    // lazy js-yaml load off the cold-start path.
    // Object-form entry pins the output path: with a single string entry
    // tsup would take src/cli as the outbase and emit dist/index.js,
    // clobbering the library's main entry.
    entry: { "cli/index": "src/cli/index.ts" },
    splitting: false,
    clean: false,
    format: ["cjs"],
    minify: true,
    dts: false,
    sourcemap: false,
    noExternal,
    define,
  },
]);

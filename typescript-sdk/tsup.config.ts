import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/observability/index.ts",
      "src/observability/instrumentation/langchain/index.ts",
      "src/cli/index.ts",
    ],
    splitting: true,
    clean: true,
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
  },
]);

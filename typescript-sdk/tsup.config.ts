import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/observability-sdk/index.ts",
      "src/observability-sdk/setup/node/index.ts",
      "src/observability-sdk/instrumentation/langchain/index.ts",
      "src/cli/index.ts",
    ],
    splitting: true,
    clean: true,
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
  },
]);

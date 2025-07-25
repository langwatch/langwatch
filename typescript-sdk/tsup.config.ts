import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/observability/index.ts",
      "src/prompt/index.ts",
      "src/evaluation/index.ts",
      "src/client-node.ts",
      "src/client-browser.ts",
    ],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
  },
]);

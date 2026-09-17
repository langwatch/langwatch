import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "@langwatch/test-harness/vitest-config";

export default defineConfig({
  test: moduleVitestTestOptions({ kind: "node", isolate: false }),
});

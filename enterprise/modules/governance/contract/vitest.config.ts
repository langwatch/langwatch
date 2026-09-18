import { moduleVitestTestOptions } from "@langwatch/test-harness/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: moduleVitestTestOptions({ kind: "node", isolate: false }),
});

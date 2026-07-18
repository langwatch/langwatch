import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    passWithNoTests: false,
    isolate: false,
    // Long timeout for scenario tests (voice scenarios can take 2-3 minutes)
    testTimeout: 300000,
    hookTimeout: 300000,
    // Run tests sequentially to avoid rate limits
    fileParallelism: false,
    sequence: {
      hooks: "stack",
      setupFiles: "stack",
    },
  },
});

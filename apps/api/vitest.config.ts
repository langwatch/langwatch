import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    testTimeout: 10_000,
    // `*.stress.test.ts` drives a LIVE deployment over HTTP with a real API
    // key and reports timings; it has no assertions a CI run can satisfy and
    // it throws on a missing `LANGWATCH_API_KEY`. `pnpm test:stress` names it
    // explicitly. Mirrors what `vitest.stress.config.ts` did for the platform
    // application, which is where this suite used to live.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.stress.test.ts"],
  },
});

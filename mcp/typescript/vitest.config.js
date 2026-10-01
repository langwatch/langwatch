import { defineConfig } from "vitest/config";

// Unit lane. The live-service lanes are vitest.integration.config.js and
// vitest.scenario.config.js; `pnpm test` never reaches either.
export default defineConfig({
  test: {
    include: ["src/**/*.unit.test.ts"],
  },
});

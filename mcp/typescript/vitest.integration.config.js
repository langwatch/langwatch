import { defineConfig } from "vitest/config";

// In-process HTTP servers, plus a Docker image built in `beforeAll`.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 10 * 60_000,
  },
});

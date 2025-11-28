import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: [
      "./test-setup.ts",
      "./src/server/event-sourcing/__tests__/integration/setup.ts",
    ],
    include: ["**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude, ".next/**/*", ".next-saas/**/*", "saas-src/**/*"],
    testTimeout: 60_000, // 60 seconds for testcontainers startup and processing
    hookTimeout: 60_000, // 60 seconds for beforeAll/afterAll hooks
    teardownTimeout: 30_000, // 30 seconds for cleanup

    // Needed until the event sourcing tests are updated to be more resilient to parallelism
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@injected-dependencies.client": join(
        __dirname,
        "./src/injection/injection.client.ts"
      ),
      "@injected-dependencies.server": join(
        __dirname,
        "./src/injection/injection.server.ts"
      ),
    },
  },
});

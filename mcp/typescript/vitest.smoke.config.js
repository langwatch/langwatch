import { defineConfig } from "vitest/config";

// The packed tarball, npm-installed from the public registry and started.
// Run after `pnpm run build`; `pnpm test` never reaches it.
export default defineConfig({
  test: {
    include: ["src/**/*.smoke.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 5 * 60_000,
  },
});

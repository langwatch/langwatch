import { defineConfig } from "vitest/config";

/**
 * Both layouts, because both are in use.
 *
 * This config predates "Move every feature package's tests beside the code
 * they cover" (5f9acf2b79). Six enterprise contract packages moved their
 * suites to `src/__tests__/` and this `include` went on naming `tests/**`
 * alone, so 16 test files across billing, licensing, managed-provider, saas,
 * scim and sso were invisible to their own runner — `vitest run` answered "No
 * test files found" and exited, which reads as a package with no tests rather
 * than one whose tests cannot be seen.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

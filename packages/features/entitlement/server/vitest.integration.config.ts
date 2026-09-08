import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract suites
 * under `src/`.
 *
 * Unlike the other feature packages, nothing here reaches Postgres: both
 * entitlement repositories read rows other features own (memberships, invites,
 * custom roles, role bindings, projects and costs), so the contract suite
 * registers the memory twin alone. See the note at the head of
 * `src/repositories/__tests__/entitlement.repositories.contract.test.ts`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts", "src/**/*.contract.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});

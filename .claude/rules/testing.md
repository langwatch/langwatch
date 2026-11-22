---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/__tests__/**"
  - "**/*.feature"
  - "**/vitest*.config.*"
---

# Tests and specs

`.claude/skills/core/testing-rules.md` is canonical; read it before writing or
running tests. `dev/docs/TESTING_PHILOSOPHY.md` has the reasoning. The ones most
often broken:

- Outside-in: spec → test → code.
- A scenario binds only with a `@unit`/`@integration`/`@e2e`/`@regression` tag
  **and** a `/** @scenario "<title>" */` annotation on the covering test. An
  untagged `.feature` reports `0/0 bound` and enforces nothing; a new wholly
  inert or partly untagged file fails the parity run.
- A test that renders a component is `.integration.test.tsx`. Its package picks
  jsdom through `defineModuleVitestConfig({ kind: "jsdom" })` from
  `@langwatch/vitest-config`, or the file carries a
  `// @vitest-environment jsdom` docblock when the package stays on node.
- Doubles: `createApiFixture<XApi>({…})` from `@langwatch/test-harness/api-fixture` (throws
  by name on anything unconfigured) and `createTestLogger()` from
  `@langwatch/test-harness`. A `{ getById: vi.fn() }` bag is a defect.
- Installation tests boot the installed list over memory twins with
  `bootInstalledProcess` (`@langwatch/process`) and `memoryStores()`
  (`@langwatch/process-stores`), standing in for uninstalled peers with
  `testPeer` (`@langwatch/process/testing`): no server, no datastore, no
  Docker (§13). Such a test is integration level; the datastore lane is the
  `test:integration` script.
- Feature parity binds every scenario (§13, 2026-10-05): a scenario you touch
  leaves bound, and new behaviour arrives with its bound scenario.
- Assert on error `code`, never message prose, and never `instanceof` across a
  serialisation boundary.
- Integration suites use native services when `LANGWATCH_TEST_CLICKHOUSE_URL`,
  `LANGWATCH_TEST_REDIS_URL`, `LANGWATCH_TEST_DATABASE_URL` are set. Never set
  `CI=1` locally; it forces testcontainers.
- After an interrupted run: `pkill -f "vitest/dist/workers"`.

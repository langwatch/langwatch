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
  untagged `.feature` reports `0/0 bound` and reads green.
- A test that renders a component is `.integration.test.tsx` with a
  `// @vitest-environment jsdom` docblock; no config sets a global environment.
- Doubles: `createApiFixture<XApi>({…})` from `@langwatch/test-harness/api-fixture` (throws
  by name on anything unconfigured) and `createTestLogger()` from
  `@langwatch/test-harness`. A `{ getById: vi.fn() }` bag is a defect.
- Installation tests run the production chain with `memoryStores()`
  (`@langwatch/process-stores`): no datastore, no Docker (ARCHITECTURE.md §13).
- Assert on error `code`, never message prose, and never `instanceof` across a
  serialisation boundary.
- Integration suites use native services when `LANGWATCH_TEST_CLICKHOUSE_URL`,
  `LANGWATCH_TEST_REDIS_URL`, `LANGWATCH_TEST_DATABASE_URL` are set. Never set
  `CI=1` locally; it forces testcontainers.
- After an interrupted run: `pkill -f "vitest/dist/workers"`.

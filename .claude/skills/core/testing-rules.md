# Testing rules

Canonical. Read with `repository-rules.md`, which covers typecheck and lint
scoping; this file covers tests.

## 1. Run tests through the owning package

Never `npx vitest`, never `npm exec vitest`, never a hand-written
`vitest.*.config.ts` in `/tmp` or a worktree. A bare config inherits none of the
repository's guardrails: vitest then defaults to the `forks` pool at
`availableParallelism - 1` workers at roughly 200 to 500 MB each, which is
several GB per run, multiplied by every agent running one.

The form is:

```
VITEST_MAX_WORKERS=2 rtk pnpm --filter <package> test:unit <paths>
```

`test:integration` exists only in packages that declare a datastore. The root
`test:integration` and `test:component` scripts are stubs that exit 1 and say so.
Never set `CI=1` locally - it forces testcontainers and disables the native mode.

## 2. Scope the run, do not serialise it

While working, run the files you touched. At the end, run the package suite
once. Never run the whole repository's tests.

Do not reach for `--maxWorkers=1` to be kind to the machine. It serialises the
run so it stays resident far longer and overlaps every other agent's run. Narrow
the path instead - that is the lever.

Never background a vitest run and never cut one short. Keep it short by scope.

After an interrupted run, sweep the orphans: `pkill -f "vitest/dist/workers"`.
Interrupted vitest workers reparent to pid 1 and keep holding their memory.

## 3. Use the harness, not hand-rolled stubs

`@langwatch/test-harness` is the toolkit:

- `createApiFixture<XApi>({ ...only the methods this test calls })` for an app or
  peer double. An uncalled method throws by name, so a test cannot pass on a
  silent no-op.
- `cleanupTestRows` for datastore rows.
- `startTestClickHouseEndpoints` when a suite needs several mutually isolated
  ClickHouse endpoints.
- `createTestLogger()` returns `{ logger, lines }` - a real pino instance writing
  synchronously into an in-memory array, read back with `lines.find(level,
  msgIncludes)`. `createLogger` is silent under vitest, so a test that asserts on
  logging never calls it directly.

A `{ getById: vi.fn() }` object literal or a class stub in a test is a defect to
fix, not a style choice.

## 4. Name the level honestly

- `*.unit.test.ts` - no rendering, no datastore.
- `*.integration.test.ts` - renders a component and mocks its boundaries, **or**
  reaches a datastore. Both are integration; the word states the level, not the
  lane.
- A test that renders a component is an integration test. Naming it a unit test
  because it feels small is the single most common mis-classification here.

Add `// @vitest-environment jsdom` as a docblock in files that need it. No config
declares a global environment, on purpose.

## 5. A regression test must execute the bug

If the bug was a runtime crash, the regression test runs the code path and
observes the crash. Asserting that a generated string now looks different is
supplementary, never the primary proof. A string-assertion test for a runtime
defect passes on the day someone reintroduces the defect.

## 6. Assert on codes, not prose

Assert on an error's `code`. The `message` is copy and will change. Use `code`
equality rather than `instanceof` anywhere the error may have crossed a process,
worker or serialisation boundary.

## 7. Test descriptions

`it("checks local first")`, never `it("should check local first")`. Inner
`describe` blocks carry the condition: `describe("when the user clicks submit")`,
not `describe("submit behaviour")`. Nest given/when as `describe` blocks rather
than writing Given/When/Then as comments in a flat test.

## 8. A scenario is not bound until it is tagged and annotated

`check-feature-parity.ts` counts only scenarios carrying `@unit`,
`@integration`, `@e2e` or `@regression`, and skips `@unimplemented`. An untagged
`.feature` file reports `0/0 scenarios bound` and `all bound`, and reads green
while enforcing nothing.

So a scenario needs both:

1. a binding tag on the scenario, and
2. a `/** @scenario "<title>" */` annotation on the test that covers it.

Read the report's verdict banner, not a per-file tick. The `spec-bind` skill is
the procedure.

Error paths get scenarios too. A failure mode named in a spec with no bound test
is a promise nobody keeps.

## 9. A green package test is not proof of wire compatibility

A package suite proves the package is internally consistent. It does not prove
that a route still answers on the same path, with the same status, to the same
caller. Those are different claims and the coordinator treats them differently.

When a change touches a route, a procedure name, an input or an output, the
proof is a transport test that mounts the real router on a real runtime, plus a
diff of the served surface against `origin/main`. Record any unavoidable
difference with its reason. A status collapsed to 200, or a setting that stopped
being configurable, is a regression and not a delta.

---
name: testing
description: "Write or review a test in LangWatch: unit vs integration level, colocated __tests__/, .unit.test.ts / .integration.test.ts(x), the jsdom docblock for component tests, createApiFixture peer doubles, memory twins, installation tests, binding a Gherkin scenario (@unit/@integration + /** @scenario */), error-code assertions, regression tests, test descriptions. Use when someone says 'write a test', 'add a unit test', 'integration test', 'component test', 'test this service', 'mock a peer', 'createApiFixture', 'memory twin', 'installation test', 'bind the scenario', 'check:feature-parity', '0/0 scenarios bound', 'it should', 'where do tests go', 'vi.spyOn', 'cast in a test', or opens a __tests__ folder."
user-invocable: true
---

# Testing

Record: `dev/docs/ARCHITECTURE.md` section 13 (testing) and 14 D (the memory-tier example). How to **run**
tests (workers, scoping, never `npx vitest`) is `.claude/skills/core/testing-rules.md`; this skill is how to
**write** them. Philosophy: `dev/docs/TESTING_PHILOSOPHY.md`.

Not here: how the module is wired into a process for the installation test (the future
`process-composition` and `module-dependencies` skills). Copy the nearest sibling test's setup for now.

## The rules that matter

1. **Specs first.** The requirement is a Gherkin scenario in `specs/` or `modules/<name>/specs/`. If none
   covers your task, write it first, error paths included.
2. **A scenario enforces nothing until bound.** It needs a level tag (`@unit`, `@integration`, `@e2e`,
   `@regression`) and the covering test carries `/** @scenario "<exact title>" */` directly above the
   `it`. Untagged scenarios read `0/0 bound` and green. `@unimplemented` marks a known gap.
3. **Tests live beside what they test**, in a colocated `__tests__/` folder. Never a root `tests/` next
   to `src/`.
4. **Name the level honestly.** `*.unit.test.ts`: no rendering, no datastore. `*.integration.test.ts`:
   reaches a datastore. `*.integration.test.tsx`: renders a component (jsdom). A test that renders is an
   integration test, however small.
5. **Doubles throw by name.** `createApiFixture<XApi>({ ...only what this test calls })`
   (`@langwatch/api-fixture`) for a peer or app. An unconfigured method throws, so a test cannot pass on a
   silent no-op. Raw clients (Prisma, ClickHouse, ioredis, Stripe) have one typed double each in
   `@langwatch/test-harness` (`client-doubles/`). A `{ fn: vi.fn() }` literal or a class stub is a defect.
6. **No casts, no spies on real services.** A class with private members is built for real over its memory
   twins, or reached through its `*Api`. A test never `vi.spyOn`s a real service; it drives memory twins
   and fixtures. A test of wrong-typed input may cast once, with `// wrong-typed input: <why>` directly above.
   A stand-in is a fixture or builder, never a new contract type.
7. **Assert on `code`, never on prose.** `expect(error.code).toBe("trigger_not_found")`. `message` is
   copy. Compare `code`, not `instanceof`, wherever the error crossed a process or serialisation boundary.
8. **A regression test executes the bug.** If it crashed at runtime, the test runs the path and observes
   the crash. A string assertion about generated output is supplementary and passes on reintroduction.
9. **Descriptions.** `it("checks local first")`, never "should". Nest `describe("when the user clicks
   submit")` for given/when instead of a flat test with comments.
10. **A green package test is not proof of wire compatibility.** For a route, procedure name, input,
    output or status, mount the real router (see below) and diff the served surface against `origin/main`.

## Backend: the shapes

| Subject | Test | Exemplar |
| --- | --- | --- |
| a service or rule | unit, over memory repositories and `createApiFixture` peers | `modules/organization/process/src/repositories/__tests__/team.service.unit.test.ts` |
| a contract schema | unit | `modules/automation/contract/src/__tests__/automation.contract.unit.test.ts` |
| a tRPC declaration | unit: names, kinds, permissions | `modules/presence/process/src/transport/__tests__/presence.trpc.unit.test.ts` |
| a REST family | integration: real router on a real runtime, assert status, body, `code` | `modules/automation/process/src/transport/__tests__/automation.rest.integration.test.ts` |
| a subscriber | unit, delivered twice (at least once) | `modules/automation/process/src/eventing/__tests__/trace-alert-trigger-match.subscriber.redelivery.test.ts` |
| a repository | a contract suite over the memory twin; the datastore twin has its own test in `prisma/__tests__/` | `modules/organization/process/src/repositories/__tests__/organization.repositories.contract.test.ts` |
| the module installs | installation test (below) | `modules/organization/process/src/app/__tests__/organization-installation.unit.test.ts` |

**The installation test** boots the real module through the same chain production uses, over the memory
tier, in each role it runs in, and calls its `*Api`. Memory bundles need no datastore and no Docker, while
peers still resolve through the real tokens. Zero test-only spellings. Always `await runtime.stop()` in a
`finally`. Role differences are tested here:
`modules/automation/process/src/app/__tests__/automation-worker-installation.unit.test.ts`.

Worked example (`modules/automation/process/src/eventing/__tests__/automation-peer-subscribers.unit.test.ts`):

```ts
describe("when trace's span event is delivered twice", () => {
  /** @scenario "A trace's span event wakes trace trigger matching, the same on redelivery" */
  it("hands trace matching the same trace, type and instant both times", async () => {
    const calls = await deliverTwice({ lane: "traceSpanTriggerMatch", event: spanEvent });
    expect(calls).toEqual([expected, expected]);
  });
});
```

with the scenario beside it in `modules/automation/specs/automation-peer-subscribers.feature`:

```gherkin
@unit
Scenario: A trace's span event wakes trace trigger matching, the same on redelivery
```

## Frontend: the shapes

- A component test is `*.integration.test.tsx` with `// @vitest-environment jsdom` (a docblock, first
  lines). No vitest config declares a global environment, so every jsdom file says it. A pure
  function or store is a `.unit.test.ts` and needs no jsdom.
- Render inside the module's host double, not a hand-rolled provider tree:
  `modules/analytics/browser/src/testing.tsx` exports `StubAnalyticsHost` and `renderWithAnalyticsHost`;
  each browser module that needs one ships its own `testing.tsx`
  (`modules/organization/browser/src/testing.tsx`). Query by role and text as a user would.
- Mutation failures are rendered from the code-keyed presentation registry; assert on the `code`, never
  toast text.
- Tests sit in `__tests__/` beside the layer they test (`model/`, `behavior/`, `ui/sections/`): see
  `modules/organization/browser/src/behavior/__tests__/` and
  `modules/automation/browser/src/ui/sections/__tests__/`. A hook is tested through a component or the
  hook harness, not by mocking React.
- Real-browser flows are e2e (`apps/ui/e2e/`), tagged `@e2e`; use the `browser-test` skill for live checks.

## Checking a binding

Run `pnpm --filter @langwatch/architecture-enforcer check:feature-parity` and read the verdict banner, not a
per-file tick: a `all bound` for one file can coexist with a failing run. A scenario bound from a package's
tests counts like one bound from a module's. Sabotage once per changed behaviour: break the path, watch the
bound test fail for the stated reason, restore.

## Traps

| Trap | Instead |
| --- | --- |
| `{ getById: vi.fn() }` as a peer | `createApiFixture<XApi>({...})` |
| `vi.spyOn(realService, ...)` | memory twin plus a fixture |
| `as unknown as Prisma` in a test | the typed double in `@langwatch/test-harness` |
| tagging a rendering test `.unit.test` | `.integration.test.tsx` |
| a scenario with no tag or no `@scenario` | tag it and annotate the test |
| asserting on error message text | assert on `code` |
| a new contract type "for the test" | a fixture or builder in `__tests__/` |
| `tests/` beside `src/` | `src/**/__tests__/` |
| running `npx vitest` or the whole repo | `VITEST_MAX_WORKERS=2 pnpm --filter <pkg> test <paths>` |
| `createLogger` in a logging test | `createTestLogger()`, read `lines` |

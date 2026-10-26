# Specs

BDD feature files describing user-facing behavior.

## Before Implementing

1. Check if a feature file already exists for your area
2. Read the scenarios - they ARE the requirements
3. If no feature file exists, create one first

## What Makes a Good Feature File

A feature file should be a **complete specification** of the work:

### Feature Complete

- All acceptance criteria from the issue are captured as scenarios
- All user-visible behaviors are described
- No gaps - if it's not in the feature file, it's not in scope

### Non-Overlapping Test Coverage

Each test level has a distinct purpose (see `dev/docs/TESTING_PHILOSOPHY.md`):

| Tag            | Purpose                       | What It Tests                               |
| -------------- | ----------------------------- | ------------------------------------------- |
| `@e2e`         | Happy paths via real examples | Full system, no mocks                       |
| `@integration` | Edge cases, error handling    | Module boundaries, external services mocked |
| `@unit`        | Pure logic, branches          | Single function/class, collaborators mocked |

**Avoid overlap**: If an E2E test covers the happy path, don't duplicate it in integration. Integration tests edge cases. Unit tests logic branches.

### Scenario Design

- One invariant per scenario
- Scenarios should be independent
- Focus on behavior, not implementation
- "When I run a scenario, traces appear" not "spawn child process with env vars"

## What Goes Here

- Observable behavior, not implementation details
- User stories, not technical architecture
- Complete coverage plan with appropriate test levels

See `dev/docs/TESTING_PHILOSOPHY.md` for detailed testing workflow and decision tree.

## From issue to feature file

Issues are written as Scrum stories: `As a <role>, I want <capability>, so that <benefit>` with Given/When/Then acceptance criteria and a separate Definition of Done.

When an issue is picked up, the story becomes the `Feature:` narrative (the As/I want/So that lines) and each acceptance criterion becomes one `Scenario:` in the feature file.

Tests bind scenarios via `/** @scenario` JSDoc annotation directly above the matching `it()` call. The binding enforces that every tagged scenario has at least one bound test.

See the "Binding Scenarios to Tests" section below.

## Binding Scenarios to Tests

Scenarios are bound to their executing tests via a `@scenario` JSDoc annotation
directly above the matching `it(...)` call:

```typescript
/** @scenario Code agent adapter falls back to legacy behavior without mappings */
it("falls back to legacy behavior: first input gets last user message, rest get empty string", async () => {
  /* ... */
});
```

The annotation must sit immediately above the `it(...)` it binds (no intervening
code). The `it()` description stays in whatever form the BDD describe/it tree
requires — the annotation is what the parity checker reads.

Annotations live in the normal test files (`*.unit.test.ts`, `*.integration.test.tsx`).
One `it()` block may carry multiple `@scenario` annotations if it covers several scenarios;
one scenario may be bound by multiple tests.

The `packages/architecture-enforcer/src/tools/check-feature-parity.ts` script parses every feature file
and fails CI if any tagged (`@unit` / `@integration` / `@e2e` / `@regression`) scenario
has no binding. Enforcement is on by default and fails closed — a new feature file
needs no registration anywhere. Three more things fail the run, each per scenario:

- A scenario carrying neither a binding tag nor `@unimplemented`.
- An `@unimplemented` scenario that cites no tracked issue. Cite it with an
  `@issue:<number>` (or `@issue-<number>`) tag, or with `#<number>` or an `/issues/<number>`
  link in a comment line directly above the scenario's tags.
- A `@scenario` annotation on a scenario with no binding tag. The test looks bound
  and the gate measures nothing; tag the scenario with the lane its test runs in.

The scenarios that already break those rules are frozen by exact title in
`packages/architecture-enforcer/src/tools/feature-parity-frozen.json`, which the Node
script and the Go port (`tools/featureparity`) both read. The list only shrinks: an
unlisted finding fails the run, and so does a listed entry that no longer applies, so
fix the scenario and delete its entry in the same change. The script also keeps
`LEGACY_UNBOUND`, a ratcheted list of files whose enforced scenarios are not yet bound.

Note what that means for an untagged scenario: it is not measured, so a file of
them reports `0/0 scenarios bound` and reads as green while binding nothing at all.
Tag the scenarios, or the spec is decorative.

Run locally:

```bash
pnpm --filter @langwatch/architecture-enforcer check:feature-parity
```

# Specs, tests and guards

## Specs are the requirements

Feature files live in `packages/features/<name>/specs/*.feature` (feature-owned) and
`specs/**` (repo-wide and cross-cutting). Write or extend the scenario before writing
code, and write the failure paths as scenarios with a named error code alongside the
golden path.

Tags decide what a scenario enforces:

| Tag              | Tests                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `@unit`          | pure logic, one function or class, collaborators mocked            |
| `@integration`   | module boundaries, external services mocked; rendering a component |
| `@e2e`           | the full system, no mocks                                          |
| `@unimplemented` | a tracked promise; exempt from binding                             |

An untagged scenario enforces nothing. A file with no enforced scenario reports
`0/0 bound · ✓ all bound` and would pass, so `check-feature-parity` tracks such files in
a deny-list (`LEGACY_INERT`) that may only shrink. Feature-file text describes behaviour
from the user's side, never config values (`job fails without retry`, not
`settings.attempts equals 1`).

## Binding

```ts
describe("given a stored secret", () => {
  describe("when the caller reads it", () => {
    /** @scenario "Secret values never leave the boundary" */
    it("returns metadata without the value", async () => { /* … */ });
  });
});
```

- The annotation is the last thing before `it(` / `test(` / `tester.run(`.
- Describe blocks are `given …` / `when …`; test names are actions, never "should".
- Assert on error `code`, never on message prose; use `code` equality across process
  boundaries rather than `instanceof`.
- A regression test for a runtime bug executes the path and observes the failure; a
  string assertion is supplementary.

## Levels and files

`<name>.<unit|integration|e2e>.test.ts` in a colocated `__tests__/`; component tests are
integration tests with `// @vitest-environment jsdom`; browser-lane tests are
`.browser.test.tsx`. Every package owns its `vitest.config.ts` (and a
`vitest.integration.config.ts` where a datastore lane exists). Integration tests that need
Postgres, ClickHouse or Redis say so in that package's config and run natively against
`LANGWATCH_TEST_*_URL` locally.

Run through the package scripts only:

```bash
pnpm --filter @langwatch/<name>-server test run src/services/__tests__/x.unit.test.ts
pnpm --filter @langwatch/<name>-web test
pnpm --filter @langwatch/platform-api test run src/app/__tests__/…
```

Never `npx vitest`, never a hand-rolled vitest config, never `--maxWorkers=1`; sweep with
`pkill -f "vitest/dist/workers"` after an interrupted run.

## Typecheck, lint, format

```bash
pnpm --filter @langwatch/<pkg> exec tsc --noEmit -p tsconfig.json   # scoped
pnpm exec oxlint <files>   ·   pnpm exec oxfmt <files>
pnpm --filter @langwatch/architecture-lint lint                      # boundary policies
pnpm --filter @langwatch/architecture-lint exec tsx src/check-feature-parity.ts
pnpm --filter @langwatch/architecture-lint test run tests/frontend-boundary.unit.test.ts
```

`pnpm typecheck` skips test files; `pnpm typecheck:all` is what CI runs. Whole-repo runs
take a machine-wide slot; from an agent shell prefer the scoped forms.

## Guards by name

| Rule                                          | Source                                                    | Catches                                                   |
| --------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `feature-source-layout`, `-filename`, `-subject` | `architecture-lint/src/feature-layout.ts`             | wrong folder, wrong dot/hyphen, another feature's subject |
| `prisma-containment`                          | `prisma-boundaries.ts`                                    | Prisma outside `repositories/prisma` / postgres adapter   |
| `typed-prisma-seam`                           | `typed-prisma-seam.ts`                                    | `as PrismaClient`, `database: object`                     |
| `private-runtime-export`                      | `feature-layout.ts`                                       | index re-exporting repositories/stores/projections        |
| `strict-port-module`                          | `port-modules.ts`                                         | a port that is not an abstract `*Port` class              |
| `api-transport-*`                             | `api-transport-boundaries.ts`                             | service locator, self-constructed services, imports       |
| `ui-web-public-entry`, `ui-screen-closure`, `ui-dependency-direction`, `ui-root-catch-all` | `frontend-ui-boundaries.ts` | web layer and entry violations                  |
| `cross-feature`, `package-cycle`, `enterprise-*` | `application-boundaries.ts`, `cycles.ts`               | wrong direction, cycles, enterprise leaks                 |
| frontend-boundary test                        | `architecture-lint/tests/frontend-boundary.unit.test.ts`  | a server value-import reaching a browser package          |
| `check-feature-parity`                        | `architecture-lint/src/check-feature-parity.ts`           | unbound or inert scenarios, unknown annotations           |
| `overengineering-audit` (skill)               | `.claude/skills/overengineering-audit`                    | one-implementation ports, pass-through layers             |

Baselines (`*-baseline.json` in `packages/architecture-lint/src`) record pre-existing
violations and may only shrink. A new violation in a file you touched is yours to fix,
not to baseline.

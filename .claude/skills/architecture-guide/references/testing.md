# Specs, tests and guards

## Specs are the requirements

Feature files live in `packages/features/<name>/specs/*.feature` (feature-owned),
any `packages/**/specs/` directory, `specs/**` (repo-wide) and `sdks/typescript/specs`.
Those are the roots `check-feature-parity` walks. Write or extend the scenario before
writing code, and write the failure paths as scenarios with a named error code alongside
the golden path.

Tags decide what a scenario enforces (`BOUND_TAGS`):

| Tag              | Tests                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `@unit`          | pure logic, one function or class, collaborators mocked            |
| `@integration`   | module boundaries, external services mocked; rendering a component |
| `@e2e`           | the full system, no mocks                                          |
| `@regression`    | a previously-fixed bug, alongside `@unit` or `@integration`        |
| `@unimplemented` | a tracked promise; exempt from binding                             |

An untagged scenario enforces nothing. A file with no enforced scenario reports
`0/0 scenarios bound · ✓ all bound` and would pass, so `check-feature-parity` tracks such
files in a deny-list (`LEGACY_INERT`) that may only shrink; `LEGACY_UNBOUND` does the
same for files with enforced-but-unbound scenarios. Feature-file text describes behaviour
from the user's side, never config values (`job fails without retry`, not
`settings.attempts equals 1`). The `spec-bind` skill is the checklist.

## Binding

```ts
describe("given a stored secret", () => {
  describe("when the caller reads it", () => {
    /** @scenario "Secret values never leave the boundary" */
    it("returns metadata without the value", async () => {
      /* … */
    });
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
`.browser.test.tsx`. Every package owns its `vitest.config.ts` and declares in that
config what it needs. A package with no datastore boots none; if you add a test that
reaches Postgres, ClickHouse or Redis, say so in that package's config rather than
relying on a repository-wide rule to notice.

## Commands

See `gates.md`. Never `npx vitest`, never a hand-rolled vitest config, never
`--maxWorkers=1`.

## Guards by name

| Rule                                                                                       | Source                                                     | Catches                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `feature-source-layout`, `-filename`, `-subject`                                           | `oxlint-plugin.mjs` over the lint-core grammar module      | wrong folder, wrong dot/hyphen, another feature's subject   |
| `prisma-containment`                                                                       | `oxlint-plugin.mjs`                                        | Prisma outside `repositories/prisma` / postgres adapter     |
| `typed-prisma-seam`                                                                        | `oxlint-plugin.mjs`, `src/typed-prisma-seam.ts`            | `as PrismaClient`, `database: object`                       |
| `private-runtime-export`                                                                   | `src/feature-layout.ts`                                    | index re-exporting repositories/stores/projections          |
| `strict-port-module`                                                                       | `src/port-modules.ts`                                      | a port that is not an abstract `*Port` class                |
| `api-transport-*`                                                                          | `src/api-transport-boundaries.ts`                          | service locator, self-constructed services, imports         |
| `ui-web-public-entry`, `ui-screen-closure`, `ui-dependency-direction`, `ui-root-catch-all` | `src/frontend-ui-boundaries.ts`                            | web layer and entry violations                              |
| `application-boundary`, `composition-source`, `enterprise-composition`, `package-cycle`    | `src/application-boundaries.ts`, `src/cycles.ts`           | wrong direction, cycles, enterprise leaks                   |
| `eventing-subscriber-idempotency`                                                          | `src/eventing-roles.ts`                                    | a subscriber that cannot be replayed                        |
| over-abstraction detectors                                                                 | `src/overengineering-policy.mjs`, `src/overengineering.ts` | identity functions, layer classes, one-implementation ports |
| frontend-boundary test                                                                     | `tests/frontend-boundary.unit.test.ts`                     | a server value-import reaching a browser package            |
| `check-feature-parity`                                                                     | `src/check-feature-parity.ts`                              | unbound or inert scenarios, unknown annotations             |

All paths are relative to `packages/architecture-lint/`. Baselines
(`*-baseline.json` in `packages/architecture-lint/src`) record pre-existing violations and
may only shrink. A new violation in a file you touched is yours to fix, not to baseline.

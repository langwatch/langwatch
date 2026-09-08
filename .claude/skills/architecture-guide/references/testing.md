# Specs, tests and guards

## Specs are the requirements

Feature files live in `packages/features/<name>/specs/*.feature` (module-owned),
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
describe("given a stored annotation", () => {
  describe("when the caller reads it", () => {
    /** @scenario "a required annotation lookup throws" */
    it("throws AnnotationNotFoundError for an unknown id", async () => {
      /* … */
    });
  });
});
```

- The annotation is the last thing before `it(` / `test(` / `tester.run(`; it may sit on
  any line of a JSDoc block. Keep comment lines under 100 columns.
- Describe blocks are `given …` / `when …`; test names are actions, never "should".
- Assert on error `code`, never on message prose; use `code` equality across process
  boundaries rather than `instanceof`.
- A regression test for a runtime bug executes the path and observes the failure; a
  string assertion is supplementary.
- Never assert a constant back at itself; a test that passes with the code reverted
  guards nothing (sabotage once and say what happened).

## The server test layout (annotation)

```
app/__tests__/annotation.fixture.ts                createAnnotationTestApp({ repositories?, dependencies? })
app/__tests__/annotation-installation.unit.test.ts createApp(...).withPersistence("memory", {}).withProvided(...).withFeature(annotationServer).boot({ role })
app/__tests__/annotation-boundary.unit.test.ts     peer errors propagate; references validated; trace markers best effort
services/__tests__/annotation-*.service.unit.test.ts
repositories/memory/__tests__/memory.*.repository.unit.test.ts
repositories/prisma/__tests__/prisma.*.repository.unit.test.ts · *.integration.test.ts
transport/__tests__/annotation.rest.integration.test.ts · annotation.trpc.*.test.ts
```

- **The fixture builds the real app over memory repositories.** `AnnotationApp.create({
  repositories: MemoryAnnotationRepositories.create(), dependencies })` with each peer a
  `createApiFixture<ProjectApi>({ getOrganizationId: async () => "org-1" })` from
  `@langwatch/test-harness/api-fixture`. A method the test did not configure throws when
  called, so a new dependency cannot pass silently. Override one repository in the bundle
  when a test needs a failing or recording store.
- **The installation test boots the installer in every role** it serves and calls the
  app through `runtime.service(AnnotationApi)`; that is what proves the registry, the
  memory bundle and the dependency declarations agree.
- **Repository tests run the same behaviour against both backends.** Memory twins are
  unit tests; the Prisma repository has a unit test over a recording client and an
  integration test against real Postgres under the package's own
  `vitest.integration.config.ts`, run with `pnpm --filter @langwatch/<f>-server test:integration`.
- **Transport tests mount the declaration** through the test harness's host and assert on
  status and `code`, not prose.
- **The process test** `apps/api/src/features/<f>/__tests__/<f>.composition.integration.test.ts`
  drives `installApi<F>` with recording peers and a recording Prisma client through the real
  tRPC and REST mounts.

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
| `feature-source-layout`, `-filename`, `-subject`                                           | `oxlint-plugin.mjs` over the lint-core grammar module      | wrong folder, wrong dot/hyphen, another module's subject   |
| `feature-shape`, `feature-shape-baseline`                                                  | `src/feature-shape.ts`                                     | a legacy piece (contract service, persistence adapter, fixtures/, testing.ts, nested transport, unregistered or memory-less repositories) not in the shrinking inventory |
| `feature-app-contract`, `feature-app-factory`                                              | `src/feature-app-contract.ts`, `src/feature-setup-infrastructure.ts` | a contract without its `*Api` token, an app whose public surface differs from its API, a capability smuggled through infrastructure |
| `prisma-containment`, `prisma-table-ownership`                                             | `oxlint-plugin.mjs`, `src/prisma-table-ownership.ts`       | Prisma outside `repositories/prisma`; two modules claiming one table |
| `typed-prisma-seam`                                                                        | `oxlint-plugin.mjs`                                        | `as PrismaClient`, `database: object`                       |
| `private-runtime-export`                                                                   | `src/feature-layout.ts`                                    | index re-exporting repositories/stores/projections          |
| `strict-port-module`                                                                       | `src/port-modules.ts`                                      | a port that is not an abstract `*Port` class                |
| `api-transport-*`, `no-raw-hono-mount`                                                     | `src/api-transport-boundaries.ts`, `oxlint-plugin.mjs`     | service locator, self-constructed services, hand-rolled routes |
| `ui-web-public-entry`, `ui-screen-closure`, `ui-dependency-direction`, `ui-root-catch-all` | `src/frontend-ui-boundaries.ts`                            | web layer and entry violations                              |
| `application-boundary`, `composition-source`, `enterprise-composition`, `package-cycle`    | `src/application-boundaries.ts`, `src/cycles.ts`           | wrong direction, cycles, enterprise leaks                   |
| `eventing-subscriber-idempotency`                                                          | `src/eventing-roles.ts`                                    | a subscriber that cannot be replayed                        |
| `secrets-through-source`                                                                   | `packages/lint-core/src/rules`                             | `process.env.<SECRET>` outside the secrets seam             |
| over-abstraction detectors                                                                 | `src/overengineering-policy.mjs`, `src/overengineering.ts` | identity functions, layer classes, one-implementation ports |
| frontend-boundary test                                                                     | `tests/frontend-boundary.unit.test.ts`                     | a server value-import reaching a browser package            |
| `check-feature-parity`                                                                     | `src/check-feature-parity.ts`                              | unbound or inert scenarios, unknown annotations             |

All paths are relative to `packages/architecture-lint/`. Baselines
(`*-baseline.json` in `packages/architecture-lint/src`) record pre-existing violations and
may only shrink. A new violation in a file you touched is yours to fix, not to baseline.

# Create a module

Read `.claude/skills/architecture-guide/SKILL.md` first, then the references for
contract, server, web and install as you reach each step. Everything below is the order
that keeps the linter green from the first commit. **Copy `modules/annotation`**;
it is the reference and the only module with no entry in
`packages/architecture-lint/src/feature-shape-baseline.json`. Do not copy a module that
still has one.

## 0. Decide the subject and check ownership

- The module's name is a lower-kebab noun (`annotation`, `model-provider`, `coding-agent`).
- Open `modules/catalogue.json`. If the subject already belongs to a module,
  stop: this is `references/extend.md` on the owner, not a new package.
- Ask only if two readings lead to materially different packages (project-scoped versus
  organization-scoped, say). Otherwise decide and state it.

## 1. Spec first

Create `modules/<name>/specs/<name>.feature`. Write the golden path and the
named failures as scenarios, each tagged `@unit` or `@integration`, each with the error
code it will carry (see the `spec-bind` skill):

```gherkin
Feature: Annotation scores
  @integration
  Scenario: A project member defines a score
    Given a project the caller may manage
    When they define a score named Accuracy with a LIKERT data type
    Then the score is listed for the project and can be attached to an annotation

  @unit
  Scenario: A score outside the project is refused
    When an annotation names a score another project owns
    Then the request fails with annotation_score_invalid
```

(`modules/annotation/specs/annotation-service.feature` is the full reference.)

Also create `modules/<name>/feature.json` with `{ "layoutVersion": 0 }`,
`adrs/README.md` with a `001-<name>-boundary.md` modelled on
`modules/annotation/adrs/001-annotation-service-boundary.md`, and add the
module to `modules/catalogue.json`:

```json
{ "id": "<name>", "root": "modules/<name>", "classification": "core", "subjects": ["<name>"] }
```

then regenerate the `ModuleName` union:
`node packages/runtime-composition/scripts/check-feature-names.mjs --write`.

## 2. Contract package

`modules/<name>/contract/` with `package.json` (`@langwatch/<name>-contract`,
copy `modules/annotation/contract/package.json`), `tsconfig.json` and
`tsconfig.build.json` (incremental, own `tsBuildInfoFile` under
`node_modules/.cache/tsbuildinfo/`), `vitest.config.ts`, and `src/`:

```
index.ts
<name>.api.ts            export interface <Name>Api { … }; export const <Name>Api = moduleApi<<Name>Api>("<name>")
<name>.schemas.ts        the domain value's zod schema and inferred types; write/read inputs as schemas
<name>-rest.schemas.ts   params/query/body/response schemas for the REST door (if public)
<name>-trpc.schemas.ts   input schemas for the tRPC door
<name>.trpc.ts           export const <name>Trpc = defineTrpcContract("<name>").query(…).withInput(…).withOutput(…).mutation(…)….build()
<name>.errors.ts         HandledError subclasses with `declare readonly code`, httpStatus, fault
```

Leave both `references` arrays empty and run `pnpm sync:references` once the
`dependencies` are written: every project reference is derived from the
manifests, and lint reports a hand-typed one as drift.

Operations use RPC verbs (`get`, `getMany`, `list`, `create`, `update`, `delete`,
`<verb><Entity>`); absence is `find*` returning `undefined`. Add each new error code to
`packages/handled-error/src/app-codes.ts` (sorted) and its customer copy to
`packages/handled-error/src/presentation.ts` in the same change. Write the contract unit
tests (`src/__tests__/<name>.unit.test.ts`) binding the `@unit` scenarios. No abstract
service: `feature-shape` inventories a `<name>.service.ts` in a contract.

## 3. Server package

`modules/<name>/server/` (`@langwatch/<name>-server`,
`"imports": { "#*": { "types": "./dist/*.d.ts", "default": "./src/*.ts" } }`):

```
src/index.ts                                          export { <name>Server } and the transport declarations, nothing else
src/<name>.server.ts                                  defineModule("<name>").withRepositories(<name>Repositories).withApp(<Name>App).withTransports(…).build()
src/app/<name>.app.ts                                 class <Name>App implements <Name>Api: static contract/dependencies, private ctor, static create(setup: FeatureSetup<…>)
src/app/__tests__/<name>.fixture.ts                   create<Name>TestApp over Memory<Name>Repositories and createApiFixture peers
src/services/<name>.service.ts                        one class per entity; static create({ repository }); parses input with contract schemas
src/rules/<name>.rules.ts                             pure helpers, if any
src/repositories/<name>.repository.ts                 the interface: findAll / findById / create / update / delete …
src/repositories/<name>.repositories.ts               interface <Name>Repositories { <entity>: <Entity>Repository; … }
src/repositories/<name>-repositories.registry.ts      defineRepositories({ postgres: Postgres<Name>Repositories, memory: Memory<Name>Repositories })
src/repositories/prisma/prisma.<name>.repository.ts   extends PrismaRepository.for("<Model>"); the only Prisma import; projectId on every query
src/repositories/prisma/prisma.<name>.repositories.ts prismaRepositories({ <entity>: Prisma<Entity>Repository })
src/repositories/memory/memory.<name>.repository.ts   the memory twin, same observable behaviour
src/repositories/memory/memory.<name>.repositories.ts static requires = [] as const; static create(): <Name>Repositories
src/transport/<name>.rest.ts                          defineRestRouter(<Name>Api).withNamespace("<name>s").withVersion(MANAGEMENT_API_VERSION)….build()   (public REST, optional)
src/transport/<name>.trpc.ts                          defineTrpcRouter(<Name>Api, <name>Trpc).procedure(name).withPermission(…).handle(…)….build()      (browser)
src/tasks/<name>.task.ts                              a one-shot program, if any
```

Peers the app needs are `*Api` tokens in `static dependencies`, never ports or imported
services; a technical dependency (encryption, object storage) is an abstract `*Port` in
`ports/` that arrives through `FeatureSetup`'s infrastructure parameter. Prisma models go
in `packages/prisma-client/prisma/schema.prisma` with a migration under
`packages/prisma-client/prisma/migrations/<timestamp>_<name>/migration.sql`; run
`pnpm start:prepare:files` after. Identifiers come from `@langwatch/ksuid`. Never
`as PrismaClient`; never `try*`/`require*`; no `adapters/postgres.*`, `fixtures/` or
`testing.ts` (`feature-shape`).

Tests: `app/__tests__/<name>-installation.unit.test.ts` boots the installer with
`createApp(...).withPersistence("memory", {}).withProvided(PeerApi, fixture).withModule(<name>Server).boot({ role })`
for every role it serves; `services/__tests__/*.unit.test.ts` over memory repositories;
`repositories/memory/__tests__` and `repositories/prisma/__tests__` (the latter with an
integration test if the package declares a datastore in `vitest.integration.config.ts`);
`transport/__tests__` through the harness host.

## 4. Web package (skip with `--no-web`)

`modules/<name>/web/` (`@langwatch/<name>-web`; `exports` lists one flat
entry per public piece plus `./testing`):

```
src/<name>s.ts                      the entry: export const <name>Screens = { <name>s: () => import("./ui/sections/<name>s-screen.tsx") }; export { <name>Api }; export { <Name>HostPort, <Name>HostProvider, use<Name>Host }
src/model/<name>-host.ts            abstract <Name>HostPort + React context (project, user, permissions, route, navigate, notify)
src/behavior/<name>-api.ts          export type <Name>ApiMap; export const <name>Api = createModuleApi<<Name>ApiMap>()
src/behavior/use-<name>s.ts         hooks over <name>Api
src/ui/elements/ … ui/blocks/ … ui/sections/<name>s-screen.tsx (default export, view as prop)
src/testing.tsx                     Stub<Name>Host extends <Name>HostPort + render harness
```

Read the `design-system` skill and the pattern doc for the surface you build. Component
tests are `.integration.test.tsx` with the jsdom docblock. Add the package to
`apps/ui/src/features/catalogue.json` → `governedWebPackages`.

## 5. Wire it

Follow `references/wire.md` for the details. In short:

- **apps/api**: `apps/api/src/features/<name>/{<name>.composition.ts, <name>.composition.types.ts, <name>-trpc.mount.ts[, <name>-rest.mount.ts]}`
  modelled on `apps/api/src/features/annotation/`; `installApi<Name>` called from
  `apps/api/src/app/api-production.composition.ts`; the namespace named in
  `apps/api/src/app-trpc/app-trpc.features.ts`; the composed slot on
  `ComposedApiFeatures` in `app-trpc.composed.ts`.
- **apps/worker** (`--worker`): install the same `<name>Server` in the capability root
  that owns its jobs (`apps/worker/src/app/worker-*.composition.ts`), list the module in
  `apps/worker/src/features/catalogue.json`; queue jobs also need an
  `apps/worker/src/features/job-registry.json` entry, which is a deliberate, reviewed
  change.
- **apps/ui**: `apps/ui/src/features/catalogue.json` `features[]` entry, private
  `apps/ui/src/features/<name>/` with `index.ts` exporting one `WebInstallation`, the
  host (`ui/sections/<name>-host.tsx`) and routes (`ui/sections/<name>-routes.tsx`), the
  installation added to `apps/ui/src/features/installed-ui-features.ts`, the page keys
  pinned in `apps/ui/tests/installed-ui-features.unit.test.ts`, and the root
  `feature-map.json`.

## 6. Gates

```bash
pnpm install    # new workspace packages
```

then `.claude/skills/architecture-guide/references/gates.md` for the three new packages,
`@langwatch/runtime-composition` (typecheck fails if `feature-names.generated.ts` lags),
`@langwatch/platform-api`, `@langwatch/ui`, architecture-lint and parity. Your new
`.feature` file must report all bound, and `feature-shape` must report nothing for the new
module: a new module never gets a baseline entry.

## Report

List the packages created, the scenarios and which tests bind them, the composition
root and registrations touched, the error codes added, and the gate numbers. Name
anything deliberately left absent and why.

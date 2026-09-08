---
name: feature-new
description: "Create a new LangWatch feature package trio (packages/features/<name>/{contract,server,web}) in the annotation shape and wire it into apps/api, apps/worker and apps/ui: spec file first, then the contract's schemas, errors and callable <Name>Api token, the server's installer, app, services, repository interfaces with Prisma and memory backends and flat REST/tRPC declarations, the web entry and api-map, the API-side composition and mounts, the UI installation and catalogue entries. Use whenever someone asks to add a feature, a new domain, a new settings page with its own data, a new tRPC/REST surface for a thing that has no package yet, or says 'scaffold', 'new feature package', 'add a <noun> feature'. Also use it when a request looks like a big addition to an existing feature but the noun is a different subject in packages/features/catalogue.json."
user-invocable: true
argument-hint: "<feature-name> [what it does] [--no-web] [--worker]"
---

# Create a feature

Read `.claude/skills/architecture-guide/SKILL.md` first, then the references for
contract, server, web and install as you reach each step. Everything below is the order
that keeps the linter green from the first commit. **Copy `packages/features/annotation`**;
it is the reference and the only feature with no entry in
`packages/architecture-lint/src/feature-shape-baseline.json`. Do not copy a feature that
still has one.

## 0. Decide the subject and check ownership

- The feature name is a lower-kebab noun (`secret`, `model-provider`, `coding-agent`).
- Open `packages/features/catalogue.json`. If the subject already belongs to a feature,
  stop: this is `feature-extend` on the owner, not a new package.
- Ask only if two readings lead to materially different packages (project-scoped versus
  organization-scoped, say). Otherwise decide and state it.

## 1. Spec first

Create `packages/features/<name>/specs/<name>.feature`. Write the golden path and the
named failures as scenarios, each tagged `@unit` or `@integration`, each with the error
code it will carry (see `spec-bind`):

```gherkin
Feature: Secrets
  @integration
  Scenario: A project member creates a secret
    Given a project the caller may manage
    When they create a secret named MY_SECRET
    Then the secret is stored encrypted and listed without its value

  @unit
  Scenario: Creating a secret with a taken name is refused
    When they create a secret whose name already exists in the project
    Then the request fails with secret_name_taken
```

Also create `packages/features/<name>/feature.json` with `{ "layoutVersion": 0 }`,
`adrs/README.md` with a `001-<name>-boundary.md` modelled on
`packages/features/annotation/adrs/001-annotation-service-boundary.md`, and add the
feature to `packages/features/catalogue.json`:

```json
{ "id": "<name>", "root": "packages/features/<name>", "classification": "core", "subjects": ["<name>"] }
```

then regenerate the `FeatureName` union:
`node packages/runtime-composition/scripts/check-feature-names.mjs --write`.

## 2. Contract package

`packages/features/<name>/contract/` with `package.json` (`@langwatch/<name>-contract`,
copy `packages/features/annotation/contract/package.json`), `tsconfig.json` and
`tsconfig.build.json` (incremental, own `tsBuildInfoFile` under
`node_modules/.cache/tsbuildinfo/`), `vitest.config.ts`, and `src/`:

```
index.ts
<name>.api.ts            export interface <Name>Api { … }; export const <Name>Api = featureApi<<Name>Api>("<name>")
<name>.schemas.ts        the domain value's zod schema and inferred types; write/read inputs as schemas
<name>-rest.schemas.ts   params/query/body/response schemas for the REST door (if public)
<name>-trpc.schemas.ts   input schemas for the tRPC door
<name>.errors.ts         HandledError subclasses with `declare readonly code`, httpStatus, fault
```

Operations use RPC verbs (`get`, `getMany`, `list`, `create`, `update`, `delete`,
`<verb><Entity>`); absence is `find*` returning `undefined`. Add each new error code to
`packages/handled-error/src/app-codes.ts` (sorted) and its customer copy to
`packages/handled-error/src/presentation.ts` in the same change. Write the contract unit
tests (`src/__tests__/<name>.unit.test.ts`) binding the `@unit` scenarios. No abstract
service: `feature-shape` inventories a `<name>.service.ts` in a contract.

## 3. Server package

`packages/features/<name>/server/` (`@langwatch/<name>-server`,
`"imports": { "#*": { "types": "./dist/*.d.ts", "default": "./src/*.ts" } }`):

```
src/index.ts                                          export { <name>Server } and the transport declarations, nothing else
src/<name>.server.ts                                  defineFeature("<name>").withRepositories(<name>Repositories).withApp(<Name>App).withTransports(…).build()
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
src/transport/<name>.rest.ts                          defineTransport(<Name>Api).withVersion(MANAGEMENT_API_VERSION).withRouter(…)   (public REST, optional)
src/transport/<name>.trpc.ts                          defineTransport(<Name>Api).withRouter(…)                                        (browser)
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
`createApp(...).withPersistence("memory", {}).withProvided(PeerApi, fixture).withFeature(<name>Server).boot({ role })`
for every role it serves; `services/__tests__/*.unit.test.ts` over memory repositories;
`repositories/memory/__tests__` and `repositories/prisma/__tests__` (the latter with an
integration test if the package declares a datastore in `vitest.integration.config.ts`);
`transport/__tests__` through the harness host.

## 4. Web package (skip with `--no-web`)

`packages/features/<name>/web/` (`@langwatch/<name>-web`; `exports` lists one flat
entry per public piece plus `./testing`):

```
src/<name>s.ts                      the entry: export const <name>Screens = { <name>s: () => import("./ui/sections/<name>s-screen.tsx") }; export { <name>Api }; export { <Name>HostPort, <Name>HostProvider, use<Name>Host }
src/model/<name>-host.ts            abstract <Name>HostPort + React context (project, user, permissions, route, navigate, notify)
src/behavior/<name>-api.ts          export type <Name>ApiMap; export const <name>Api = createFeatureApi<<Name>ApiMap>()
src/behavior/use-<name>s.ts         hooks over <name>Api
src/ui/elements/ … ui/blocks/ … ui/sections/<name>s-screen.tsx (default export, view as prop)
src/testing.tsx                     Stub<Name>Host extends <Name>HostPort + render harness
```

Read the `design-system` skill and the pattern doc for the surface you build. Component
tests are `.integration.test.tsx` with the jsdom docblock. Add the package to
`apps/ui/src/features/catalogue.json` → `governedWebPackages`.

## 5. Wire it

Follow `.claude/skills/feature-wire/SKILL.md` for the details. In short:

- **apps/api**: `apps/api/src/features/<name>/{<name>.composition.ts, <name>.composition.types.ts, <name>-trpc.mount.ts[, <name>-rest.mount.ts]}`
  modelled on `apps/api/src/features/annotation/`; `installApi<Name>` called from
  `apps/api/src/app/api-production.composition.ts`; the namespace named in
  `apps/api/src/app-trpc/app-trpc.features.ts`; the composed slot on
  `ComposedApiFeatures` in `app-trpc.composed.ts`.
- **apps/worker** (`--worker`): install the same `<name>Server` in the capability root
  that owns its jobs (`apps/worker/src/app/worker-*.composition.ts`), list the feature in
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
feature: a new feature never gets a baseline entry.

## Report

List the packages created, the scenarios and which tests bind them, the composition
root and registrations touched, the error codes added, and the gate numbers. Name
anything deliberately left absent and why.

---
name: feature-new
description: "Create a new LangWatch feature package trio (packages/features/<name>/{contract,server,web}) in the strict layout and wire it into apps/api, apps/worker and apps/ui: spec file first, then contract schemas and abstract service, server service/repository/adapter/transport, web screen and api-map, API-side composition, tRPC namespace or REST family, UI install and catalogue entries. Use whenever someone asks to add a feature, a new domain, a new settings page with its own data, a new tRPC/REST surface for a thing that has no package yet, or says 'scaffold', 'new feature package', 'add a <noun> feature'. Also use it when a request looks like a big addition to an existing feature but the noun is a different subject in packages/features/catalogue.json."
user-invocable: true
argument-hint: "<feature-name> [what it does] [--no-web] [--worker]"
---

# Create a feature

Read `.claude/skills/architecture-guide/SKILL.md` first, then the references for
contract, server, web and install as you reach each step. Everything below is the order
that keeps the linter green from the first commit.

## 0. Decide the subject and check ownership

- The feature name is a lower-kebab noun (`secret`, `model-provider`, `coding-agent`).
- Open `packages/features/catalogue.json`. If the subject already belongs to a feature,
  stop: this is `feature-extend` on the owner, not a new package.
- Copy shape from the closest existing feature: `secret` is the smallest complete one
  (contract + server + web + public REST + tRPC), `topic` the smallest tRPC-only
  composition, `prompt` a large web package.
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

Also create `packages/features/<name>/feature.json` with `{ "layoutVersion": 0 }` and add
the feature to `packages/features/catalogue.json`:

```json
{
  "id": "<name>",
  "root": "packages/features/<name>",
  "classification": "core",
  "subjects": ["<name>"]
}
```

## 2. Contract package

`packages/features/<name>/contract/` with `package.json` (`@langwatch/<name>-contract`,
copy `packages/features/secret/contract/package.json`), `tsconfig.json` (incremental,
with its own `tsBuildInfoFile` under `node_modules/.cache/tsbuildinfo/`),
`vitest.config.ts`, and `src/`:

```
index.ts
<name>.ts               domain value + zod schema
<name>.service.ts       abstract <Name>Service
<name>.commands.ts      write inputs
<name>.queries.ts       read inputs / outputs, and the …PublicRest declaration if public
<name>.errors.ts        HandledError subclasses
```

Add each new error code to `packages/handled-error/src/app-codes.ts` (sorted) and its
customer copy to `packages/handled-error/src/presentation.ts` in the same change.
Write the contract unit tests (`src/__tests__/<name>.unit.test.ts`) binding the `@unit`
scenarios.

## 3. Server package

`packages/features/<name>/server/` (`@langwatch/<name>-server`,
`"imports": { "#*": "./src/*.ts" }`):

```
src/index.ts                                   export the service, the adapters, the transports
src/app/<name>.app.ts                          one class every transport calls; authz here
src/services/<name>.service.ts                 implements the contract's abstract service
src/rules/<name>.rules.ts                      pure helpers, if any
src/repositories/<name>.repository.ts          abstract: findAll / findById / create / …
src/repositories/prisma/prisma.<name>.repository.ts   the only Prisma import; projectId on every query
src/adapters/postgres.<name>.adapter.ts        takes { prisma: PrismaClient }, builds the repository
src/ports/<name>.port.ts                       only if the feature needs something it does not own
src/transport/api-trpc/<name>.api.ts           router fragment over the contract schemas
src/transport/public-rest/<name>.api.ts        the RestService builder (optional, ADR-128)
src/tasks/<name>.task.ts                       a one-shot program, if any
```

Prisma models go in `packages/prisma-client/prisma/schema.prisma` with a migration under
`packages/prisma-client/prisma/migrations/<timestamp>_<name>/migration.sql`; run
`pnpm start:prepare:files` after. Tests: `services/__tests__/<name>.service.unit.test.ts`
over an in-memory repository, and `repositories/prisma/__tests__/*.integration.test.ts`
if the package declares a datastore lane in its own vitest config. Never `as PrismaClient`;
never `require*`; identifiers come from `@langwatch/ksuid`.

## 4. Web package (skip with `--no-web`)

`packages/features/<name>/web/` (`@langwatch/<name>-web`; `exports` only
`./screens/<name>` and any `./surfaces/<id>`):

```
src/model/<name>-host.ts            abstract <Name>HostPort (session, project, navigation)
src/behavior/<name>-api.ts          export type <Name>ApiMap; export const <name>Api = createFeatureApi<…>()
src/behavior/use-<name>s.ts         hooks over <name>Api
src/ui/elements/ … ui/blocks/ … ui/sections/ …
src/screens/<name>/index.ts         export <name>Screens (lazy), <name>Api, <Name>HostPort
src/screens/<name>/<name>s.screen.tsx
src/testing.tsx
```

Read the `design-system` skill and the pattern doc for the surface you build. Component
tests are `.integration.test.tsx` with the jsdom docblock. Add the package to
`apps/ui/src/features/catalogue.json` → `governedWebPackages`.

## 5. Wire it

Follow `.claude/skills/feature-wire/SKILL.md` for the details. In short:

- **apps/api**: `apps/api/src/features/<name>/{<name>.composition.ts,
<name>.composition.types.ts, <name>-trpc.mount.ts}`, the namespace named in
  `apps/api/src/app-trpc/app-trpc.features.ts`, and — for a public REST family —
  `apps/api/src/api-<name>-rest.feature.ts` mounted from
  `apps/api/src/app/api-production.composition.ts`. Name any absence.
- **apps/worker** (`--worker`): an installer in
  `apps/worker/src/features/<name>/<name>-worker-feature.installer.ts`, listed in
  `apps/worker/src/features/catalogue.json`; queue jobs also need an
  `apps/worker/src/features/job-registry.json` entry, which is a deliberate, reviewed
  change.
- **apps/ui**: `apps/ui/src/features/catalogue.json` `features[]` entry, private
  `apps/ui/src/features/<name>/` with the routes file and host, the `uiFeature(...)`
  value added to `apps/ui/src/features/installed-ui-features.ts`, the page key in
  `apps/ui/src/model/ui-route-table.ts`, and the root `feature-map.json`.

## 6. Gates

```bash
pnpm install    # new workspace packages
```

then `.claude/skills/architecture-guide/references/gates.md` for the three new packages,
`@langwatch/platform-api`, `@langwatch/ui`, architecture-lint and parity. Your new
`.feature` file must report all bound.

## Report

List the packages created, the scenarios and which tests bind them, the composition
root and registrations touched, the error codes added, and the gate numbers. Name
anything deliberately left absent and why.

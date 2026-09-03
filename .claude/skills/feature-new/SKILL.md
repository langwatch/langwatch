---
name: feature-new
description: "Create a new LangWatch feature package trio (packages/features/<name>/{contract,server,web}) in the strict layout and wire it into apps/api, apps/worker and apps/ui: spec file first, then contract schemas and abstract service, server service/repository/adapter/transport, web screen and api-map, composition root, REST family registration, UI install and catalogue entries. Use this whenever someone asks to add a feature, a new domain, a new settings page with its own data, a new tRPC/REST surface for a thing that has no package yet, or says 'scaffold', 'new feature package', 'add a <noun> feature'. Also use it when a request looks like a big addition to an existing feature but the noun is a different subject in packages/features/catalogue.json."
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
- Find the closest existing feature to copy shape from. `secret` is the smallest complete
  one (contract + server + web + REST + tRPC); `authz` shows eventing; `prompt` shows a
  large web package.
- Ask only if two readings lead to materially different packages (for example whether
  the thing is project-scoped or organization-scoped). Otherwise decide and state it.

## 1. Spec first

Create `packages/features/<name>/specs/<name>.feature`. Write the golden path and the
named failures as scenarios, each tagged `@unit` or `@integration`, each with the error
code it will carry:

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
copy `secret/contract/package.json`), `tsconfig.json` (incremental with its own
`tsBuildInfoFile`), `vitest.config.ts`, and `src/`:

```
index.ts
<name>.ts               domain value + zod schema
<name>.service.ts       abstract <Name>Service
<name>.commands.ts      write inputs
<name>.queries.ts       read inputs / outputs
<name>.errors.ts        HandledError subclasses
```

Add each new error code to `packages/handled-error/src/app-codes.ts` (sorted) and its
customer copy to `packages/handled-error/src/presentation.ts` in the same change.
Write the contract unit tests (`src/__tests__/<name>.unit.test.ts`) binding the `@unit`
scenarios.

## 3. Server package

`packages/features/<name>/server/` (`@langwatch/<name>-server`, `"imports": { "#*": "./src/*.ts" }`):

```
src/index.ts                                   export the service, the adapters, the transports
src/app/<name>.app.ts                          one class both transports call; authz here
src/services/<name>.service.ts                 implements the contract's abstract service
src/repositories/<name>.repository.ts          abstract: findAll / findById / create / …
src/repositories/prisma/prisma.<name>.repository.ts   the only Prisma import; projectId on every query
src/adapters/postgres.<name>.adapter.ts        takes { prisma: PrismaClient }, builds the repository
src/ports/<name>.port.ts                       only if the feature needs something it does not own
src/transport/api-trpc/<name>.api.ts           router fragment over the contract schemas
src/transport/api-rest/<name>.api.ts           Hono app via @langwatch/api/rest (optional)
```

Prisma models go in `packages/prisma-client/prisma/schema.prisma` with a migration under
`packages/prisma-client/prisma/migrations/<timestamp>_<name>/migration.sql`; run
`pnpm start:prepare:files` after. Tests: `services/__tests__/<name>.service.unit.test.ts`
over an in-memory repository, and `repositories/prisma/__tests__/*.integration.test.ts`
if the package declares a datastore lane. Never `as PrismaClient`; never `require*`.

## 4. Web package (skip with `--no-web`)

`packages/features/<name>/web/` (`@langwatch/<name>-web`; `exports` only
`./screens/<name>` and, if drawers exist, `./drawers`):

```
src/model/<name>-host.ts            abstract <Name>HostPort (session, project, navigation)
src/behavior/<name>-api.ts          export type <Name>ApiMap; export const <name>Api = createFeatureApi<…>()
src/behavior/use-<name>s.ts         hooks over <name>Api
src/ui/elements/ … ui/blocks/ … ui/sections/ …
src/screens/<name>/index.ts         export <name>Screens (lazy), <name>Api, <Name>HostPort
src/screens/<name>/<name>s.screen.tsx
src/testing.tsx
```

Read `dev/docs/best_practices/react.md` and the pattern doc for the surface you build
(drawers, row actions, selection bar, scope picker). Component tests are
`.integration.test.tsx` with the jsdom docblock. Add the package to
`apps/ui/src/features/catalogue.json` → `governedWebPackages`.

## 5. Wire it

Follow `.claude/skills/feature-wire/SKILL.md` for the details. In short:

- **apps/api**: a root `apps/api/src/app/api-<name>.composition.ts` that builds the
  Postgres adapter over the process's `PrismaClient`, constructs the service, and hands
  the tRPC fragment to the right `api-trpc-collaborators.<group>.composition.ts` and the
  REST app to `apps/api/src/app-rest/app-rest.packaged-families.ts`. Name any absence.
- **apps/worker** (`--worker`): an installer in
  `apps/worker/src/features/<name>/<name>-worker-feature.installer.ts`, listed in
  `apps/worker/src/features/catalogue.json`; queue jobs also need a `job-registry.json`
  entry, which is a deliberate, reviewed change.
- **apps/ui**: `catalogue.json` `features[]` entry, private
  `apps/ui/src/features/<name>/` with the routes file and host, registration in
  `installed-ui-features.ts` (+ `installed-ui-drawers.ts`), the page key in
  `apps/ui/src/model/ui-route-table.ts`, and the root `feature-map.json`.

## 6. Gates, scoped

```bash
pnpm install                                                    # new workspace packages
pnpm --filter @langwatch/<name>-contract test && pnpm --filter @langwatch/<name>-server test && pnpm --filter @langwatch/<name>-web test
pnpm --filter @langwatch/<name>-server exec tsc --noEmit -p tsconfig.json   # and -contract, -web
pnpm --filter @langwatch/platform-api exec tsc --noEmit -p tsconfig.json
pnpm --filter @langwatch/ui exec tsc --noEmit -p tsconfig.json
pnpm --filter @langwatch/ui test run tests/installed-ui-features.unit.test.ts
pnpm --filter @langwatch/architecture-lint lint
pnpm --filter @langwatch/architecture-lint exec tsx src/check-feature-parity.ts   # your .feature: all bound
pnpm exec oxlint <touched> && pnpm exec oxfmt <touched>
```

Do not run the root `pnpm typecheck` for this; CI's `typecheck:all` covers the tree.

## Report

List the packages created, the scenarios and which tests bind them, the composition
root and registrations touched, the error codes added, and the gate numbers. Name
anything deliberately left absent and why.

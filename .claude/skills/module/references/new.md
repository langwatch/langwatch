# Create a module

Read `dev/docs/ARCHITECTURE.md` §3 first, then this file end to end before
writing anything. Everything below is the order that keeps the linter green
from the first commit. **Copy `modules/annotation`**; it is the shape
reference and the only module with no entry in
`packages/architecture-enforcer/src/feature-shape-baseline.json`. Translate
every file you copy through record §16 as you go: `server`→`process`,
`web`→`browser`, `defineServerModule`→`defineProcessModule`, `<Name>App` +
`.withApp(...)`→`<Name>Module` + `.withApi(...)`.

## 0. Decide the subject and check ownership

- The module's name is a lower-kebab noun (`annotation`, `model-provider`,
  `coding-agent`).
- Open `modules/catalogue.json`. If the subject already belongs to a module,
  stop: this is `references/extend.md` on the owner, not a new package.
- Ask only if two readings lead to materially different packages
  (project-scoped versus organization-scoped, say). Otherwise decide and
  state it.

## 1. Spec first

Create `modules/<name>/specs/<name>.feature`. Write the golden path and the
named failures as scenarios, each tagged `@unit` or `@integration`, each with
the error code it will carry (see the `spec-bind` skill):

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

Also create `modules/<name>/feature.json` with `{ "layoutVersion": 0 }`,
`adrs/README.md` with a `001-<name>-boundary.md`, and add the module to
`modules/catalogue.json`:

```json
{ "id": "<name>", "root": "modules/<name>", "classification": "core", "subjects": ["<name>"] }
```

then regenerate the module-name union per the project's own generator script.

## 2. Contract package

`modules/<name>/contract/` with `package.json` (`@langwatch/<name>-contract`),
`tsconfig.json`/`tsconfig.build.json` (incremental, own `tsBuildInfoFile`),
`vitest.config.ts`, and `src/`:

```
index.ts
<name>.api.ts            export interface <Name>Api { … }; export const <Name>Api = moduleApi<<Name>Api>("<name>")
<name>.schemas.ts        the domain value's zod schema and inferred types; write/read inputs as schemas
<name>-rest.schemas.ts   params/query/body/response schemas for the REST door (if public)
<name>-trpc.schemas.ts   input schemas for the tRPC door
<name>.trpc.ts           export const <name>Trpc = defineTrpcContract("<name>").query(…).withInput(…).withOutput(…).mutation(…)….build()
<name>.errors.ts         HandledError subclasses with `declare readonly code`, httpStatus, fault
<name>.config.ts         Config.define({ … }) if the module needs any deployment fact (record §6, §3.3 case 3) — omit entirely if it needs none
```

Leave both `references` arrays empty and run `pnpm sync:references` once the
`dependencies` are written. Every new manifest's dependency versions come
from the pnpm catalog (`pnpm-workspace.yaml`'s `catalog:` block) — write
`"dep": "catalog:"` for anything already listed there.

Operations use RPC verbs (`get`, `getMany`, `list`, `create`, `update`,
`delete`, `<verb><Entity>`); absence is `find*` returning `undefined`. Add
each new error code to `packages/handled-error/src/app-codes.ts` (sorted) and
its customer copy to `packages/handled-error/src/presentation.ts` in the same
change. Write the contract unit tests (`src/__tests__/<name>.unit.test.ts`)
binding the `@unit` scenarios. No abstract service class in the contract —
that is a `feature-shape: contract-service` finding, not a pattern.

## 3. Process package

`modules/<name>/process/` (`@langwatch/<name>-process`,
`"imports": { "#*": { "types": "./dist/*.d.ts", "default": "./src/*.ts" } }`):

```
src/index.ts                                          export { <name>ProcessModule } and the transport declarations, nothing else
src/<name>.module.ts                                  defineProcessModule("<name>").withRepositories(<name>Repositories).withApi(<Name>Module).withTransports(…) — same file also defines class <Name>Module implements <Name>Api: static contract/dependencies, private ctor, static create(setup)
src/__tests__/<name>.fixture.ts                       create<Name>TestModule over Memory<Name>Repositories and createApiFixture peers
src/services/<name>.service.ts                        one class per entity; static create({ repository }); parses input with contract schemas
src/rules/<name>.rules.ts                             pure helpers, if any
src/repositories/<name>.repository.ts                 the interface: findAll / findById / create / update / delete …
src/repositories/<name>.repositories.ts               interface <Name>Repositories { <entity>: <Entity>Repository; … }
src/repositories/<name>-repositories.registry.ts      defineRepositories({ live: Postgres<Name>Repositories, memory: Memory<Name>Repositories })
src/repositories/prisma/prisma.<name>.repository.ts   extends PrismaRepository.for("<Model>"); the only Prisma import; projectId on every query
src/repositories/prisma/prisma.<name>.repositories.ts prismaRepositories({ <entity>: Prisma<Entity>Repository })
src/repositories/memory/memory.<name>.repository.ts   the memory twin, same observable behaviour
src/repositories/memory/memory.<name>.repositories.ts static requires = [] as const; static create(): <Name>Repositories
src/channels/<subject>.channel.ts                     an interface per subject the module does not own the state of
src/channels/<name>-channels.registry.ts              { live: Http<Name>Channels, memory: Memory<Name>Channels }, each a class with static create
src/channels/<tier>/<tier>.<subject>.channel.ts       one live implementation per tier: eventing, redis, http, sqs, ses, slack
src/channels/memory/memory.<subject>.channel.ts       the twin every test asserts against
src/transport/<name>.rest.ts                          defineRestRouter(<Name>Api).withNamespace("<name>s")….build()   (public REST, optional)
src/transport/<name>.trpc.ts                          defineTrpcRouter(<Name>Api, <name>Trpc).procedure(name).withPermission(…).handle(…)….build()      (browser)
src/eventing/<name>.pipeline.ts                        definePipeline("<name>") — only if the module owns events, commands, projections, subscribers or jobs (record §9)
src/tasks/<name>.task.ts                              a one-shot program, if any
```

Peers `<Name>Module` needs are `*Api` tokens in `static dependencies`, never
imported services (four-way rule case 2). A deployment fact is the module's
own config schema, sliced in by `.withConfig` (case 3). An availability
decision is a declared supply token the process answers with `.provide({...})`
(case 4). Prisma models go in `packages/prisma-client/prisma/schema.prisma`
with a migration under
`packages/prisma-client/prisma/migrations/<timestamp>_<name>/migration.sql`;
run `pnpm start:prepare:files` after. Identifiers come from `@langwatch/ksuid`.
Never `as PrismaClient`; never `try*`/`require*`; no `ports/`, `adapters/`,
`composition/`, `utils/`, `lib/`, `helpers/`, `domain/` folder.

Messages to or from something the module does not own — the event bus, Redis
pub/sub, a vendor over HTTP, a queue, email, Slack, a browser over SSE — are a
channel, not a service member: declare the interface in `channels/`, put the
conduit in `channels/<tier>/` beside its memory twin, and register both as
`{ live, memory }` in the registry. A service that imports the bus, pub/sub or
an HTTP client is refused by `service-does-not-open-a-channel`.

Tests: `__tests__/<name>-installation.unit.test.ts` boots the installer
through `createApp({ role }).withModules([<name>ProcessModule])` with memory
storage supplied through `.withStores(memoryStores())` — never a per-store
`with*` call, never `withProvided`/`withPersistence` (record §15);
`services/__tests__/*.unit.test.ts` over memory repositories;
`repositories/memory/__tests__` and `repositories/prisma/__tests__` (the
latter with an integration test if the package declares a datastore in
`vitest.integration.config.ts`); `transport/__tests__` through the harness
host.

## 4. Browser package (skip with `--no-browser`)

`modules/<name>/browser/` (`@langwatch/<name>-browser`; `exports` lists one
flat entry per public piece plus `./testing` and `./declaration`):

```
src/<name>s.ts                      the entry: export const <name>Screens = { <name>s: () => import("./ui/sections/<name>s-screen.tsx") }; export { <name>Api }; export { <Name>HostApi, <Name>HostProvider, use<Name>Host }
src/declaration.ts                  export default defineBrowserModule("<name>") … — screens, drawers, publications, mounts, flags
src/model/<name>-host.ts            abstract <Name>HostApi + React context (project, user, permissions, route, navigate, notify)
src/behavior/<name>-api.ts          export type <Name>ApiMap; export const <name>Api = createModuleApi<<Name>ApiMap>()
src/behavior/use-<name>s.ts         hooks over <name>Api
src/ui/elements/ … ui/blocks/ … ui/sections/<name>s-screen.tsx (default export, view as prop)
src/testing.tsx                     Stub<Name>Host extends <Name>HostApi + render harness
```

Read the `design-system` skill and the pattern doc for the surface you build.
Component tests are `.integration.test.tsx` with the jsdom docblock. A
`browser-kit` package is created only when a *different* module needs a piece
of this one — see `references/web-surface.md` — never speculatively.

## 5. Wire it

Follow `references/wire.md`. In short: add the module to
`modules/catalogue.json`, run `pnpm generate:modules`, and every process that
boots `processModules` installs it — no process file changes, and a
requirement `boot()` cannot satisfy fails to compile, naming the module.

## 6. Gates

```bash
pnpm install    # new workspace packages
```

Then, for the new packages plus every process that installs the module:
`pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test`,
`pnpm --filter @langwatch/architecture-enforcer lint` and `check:feature-parity`.
Your new `.feature` file must report all bound, and `feature-shape` must
report nothing for the new module: a new module never gets a baseline entry.

## Report

List the packages created, the scenarios and which tests bind them, the
catalogue registration, the error codes added, and the gate results. Name
anything deliberately left absent and why.

---
name: architecture-guide
description: "The reference for the LangWatch repository layout: what apps/ui, apps/api, apps/worker and apps/tasks are, what a module is (contract/server/web), the server shape the annotation module set (one installer, one app, private services, repository interfaces with Prisma and memory backends, flat REST and tRPC declarations), the web layer order (model, behavior, ui/elements, ui/blocks, ui/sections, flat entry files), how config, composition roots, UI install and specs work, and which architecture-enforcer rule enforces each. Read this whenever you touch anything under modules, enterprise/modules, apps/api/src/app, apps/api/src/features, apps/worker/src/app or apps/ui/src/features, or when a user asks where something should live, why a lint rule fired, what an app/service/repository is here, or how a module is wired. The task skills `module` (build or change one: new, extend, including REST endpoints and tRPC procedures, convert, wire, move, web-surface) and `module-review` (audit one, or for over-abstraction) build on it, alongside `spec-bind` (bind a scenario to a test) and `lint-rule` (add or change a house lint rule)."
user-invocable: true
argument-hint: "[layer: contract | server | web | config | composition | install | testing | gates]"
---

# LangWatch architecture guide

The product is four Node applications: `apps/ui` (browser), `apps/api` (tRPC + REST +
SSE), `apps/worker` (queues, schedulers, projections) and `apps/tasks` (one-shot
programs), plus the Go services `services/aigateway`, `services/nlpgo` and
`services/langyagent`. Applications hold no product code: they boot modules over
their own database, Redis and ClickHouse handles through `@langwatch/runtime-composition`.

A **module** is a folder `modules/<name>/` that owns three workspace
packages. One word throughout: the folder is `modules/`, the identifiers are
`defineModule`, `withModule`, `moduleApi`, `installApi<Name>`, `<Name>Api` and
`ModuleName`, and in conversation and in these skills the word for this shape
is "module".

| Directory  | Package                      | Holds                                                                          |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `contract` | `@langwatch/<name>-contract` | zod schemas, portable types, `HandledError` subclasses, the callable `<Name>Api` |
| `server`   | `@langwatch/<name>-server`   | the installer, the app, private services and repositories, REST/tRPC declarations |
| `web`      | `@langwatch/<name>-web`      | screens, surfaces, hooks, pure view models (optional)                          |

The root is not a package. It holds `feature.json` (`{ "layoutVersion": 0 }`), `specs/`
and `adrs/`. Enterprise modules mirror this under `enterprise/modules/<name>`;
`enterprise/packages/composition/{api,worker}` compose the backend halves, and enterprise
web packages install through `apps/ui/src/features/catalogue.json` like any other `*-web`.

**The reference module is `annotation`** (`modules/annotation`, ADR-001 in its
`adrs/`, shared decision ADR-133). Every other module is being converted to its shape;
`packages/architecture-enforcer/src/feature-shape-baseline.json` is the list of what each
module still carries from the older shape, and it may only shrink. Copy annotation, not
the module next to it. Pointed at any other module, the `module` skill's references
produce this same shape: `references/convert.md` closes a module's entries kind by kind;
`references/new.md`, `references/extend.md` and `references/web-surface.md` add to it.

```
modules/annotation/
├── feature.json · specs/ · adrs/
├── contract/src/
│   ├── annotation.api.ts            interface AnnotationApi + moduleApi token
│   ├── annotation.trpc.ts · annotation-score.trpc.ts   defineTrpcContract: every procedure's name, kind, input, output
│   ├── annotation.schemas.ts · annotation-queue.schemas.ts · annotation-rest.schemas.ts · annotation-trpc.schemas.ts
│   ├── annotation.errors.ts · annotation-queue.errors.ts
│   └── annotation-*.types.ts · index.ts
├── server/src/
│   ├── annotation.server.ts         defineModule("annotation").withRepositories(...).withApp(...).withTransports(...).build()
│   ├── index.ts                     exports the installer and the transport declarations, nothing else
│   ├── app/annotation.app.ts        class AnnotationApp implements AnnotationApi; owns the private services
│   ├── services/*.service.ts        one class per entity, each over its repository interface
│   ├── repositories/*.repository.ts interfaces · annotation.repositories.ts (the bundle) · annotation-repositories.registry.ts
│   ├── repositories/prisma/         prisma.*.repository.ts + prisma.annotation.repositories.ts
│   ├── repositories/memory/         memory.*.repository.ts + memory.annotation.repositories.ts
│   ├── channels/*.channel.ts        interfaces for messages the module does not own · annotation-channels.registry.ts
│   ├── channels/eventing/           eventing.*.channel.ts (the bus); channels/{redis,http,sqs,ses,slack}/ likewise
│   ├── channels/memory/             memory.*.channel.ts, the twin of every live channel
│   └── transport/annotation.rest.ts · annotation.trpc.ts · annotation-score.trpc.ts
└── web/src/
    ├── annotations.ts · annotation-card.ts · annotation-form.ts · …   flat public entries
    ├── model/ · behavior/ · ui/elements/ · ui/blocks/ · ui/sections/
    └── testing.tsx
```

Dependency direction, with no exceptions:

```
apps/ui     -> @langwatch/<f>-web    -> @langwatch/<f>-contract
apps/api    -> @langwatch/<f>-server -> @langwatch/<f>-contract
apps/worker -> @langwatch/<f>-server -> @langwatch/<f>-contract
apps/tasks  -> @langwatch/<f>-server -> @langwatch/<f>-contract
```

web never imports server; server never imports web; contract imports no framework and no
other half. Another module imports only the owner's contract, names the owner's `*Api`
token in its app's `static dependencies`, and receives the owner's app at boot. Nobody
imports another module's service or repository. `modules/catalogue.json` maps
every subject to exactly one owning module; `feature-source-subject` fires when a
filename claims another module's subject, and `ModuleName` (the type `defineModule`
and `moduleApi` accept) is generated from that catalogue.

## Which reference to read

Read the one that matches the layer you are about to touch. Each is short.

- `references/contract.md`: what may live in `contract/src`, the callable API and its
  token, zod-with-infer, `HandledError` subclasses with stable codes, operation naming.
- `references/server.md`: the installer, the app, services, repository interfaces and
  their Prisma and memory backends, the registry, flat transports, technical ports, rules
  modules, the folder grammar and filename rules.
- `references/web.md`: the layer order and import matrix, flat entries versus screens
  versus surfaces versus pages, host ports, the api-map, drawers.
- `references/config-composition.md`: `RuntimeConfig` and `Config.group`, the per-process
  config modules, the root `.env`, `createApp(...).withPersistence().withProvided().withModule().boot()`,
  the REST and tRPC mounts in `apps/api/src/features/<f>/`, the worker, producer-only
  eventing.
- `references/install.md`: the steps that put a screen in front of a user
  (catalogue.json, the private module folder, `WebInstallation`, routes, feature-map.json).
- `references/testing.md`: specs first, `@scenario` binding, test levels, the annotation
  test layout (fixture beside the app, memory repositories, `createApiFixture` peers),
  the guards by name.
- `references/gates.md`: the exact commands every task skill ends with.

## The rules that bite most often

- The contract's capability is `<f>.api.ts`: one `interface <F>Api` of callable operations
  and `export const <F>Api = moduleApi<<F>Api>("<f>")`. There is no abstract service in a
  contract any more (`feature-shape: contract-service`).
- The server exposes one app. `app/<f>.app.ts` is `class <F>App implements <F>Api` with
  `static readonly contract`, `static readonly dependencies`, a private constructor and
  `static create(setup: FeatureSetup<…>)`. Services and peers are `#private` fields; the
  public surface is exactly the API's operations (`feature-app-contract`).
- Persistence is chosen once, at boot. Repository interfaces sit in `repositories/`, the
  Prisma implementations in `repositories/prisma/`, their memory twins in
  `repositories/memory/`, and `repositories/<f>-repositories.registry.ts` offers both
  through `defineRepositories({ postgres, memory })`. No `adapters/postgres.*.adapter.ts`
  (`feature-shape: persistence-adapter`, `postgres-without-memory`,
  `unregistered-repositories`).
- A collaborator the module does not own is a channel, not a service. Messages to or
  from the event bus, Redis pub/sub, a vendor over HTTP, a queue, email, Slack or a
  browser over SSE go through `channels/<subject>.channel.ts` with implementations in
  `channels/<tier>/<tier>.<subject>.channel.ts` (`eventing`, `redis`, `http`, `sqs`,
  `ses`, `slack`), a memory twin beside them, and both offered through
  `channels/<f>-channels.registry.ts` with `defineChannels({ live, memory })`. A file
  under `services/` that imports the bus, pub/sub or an HTTP client is refused
  (`service-does-not-open-a-channel`); a live channel with no twin or no registry entry
  is `feature-shape: unregistered-channels`. Repository is state the module owns,
  channel is messages it does not, service is behaviour over both, and a pool member is
  the raw client a channel wraps.
- A tRPC procedure is declared once, in the contract (`<f>.trpc.ts`,
  `defineTrpcContract`: name, kind, input, output); the server's `transport/<f>.trpc.ts`
  binds permission and handler with `defineTrpcRouter(<F>Api, <f>Trpc)` and repeats
  nothing; the browser derives its client from the same declaration. REST is one complete
  endpoint per route in `transport/<f>.rest.ts` via `defineRestRouter(<F>Api)`. Handlers
  read `{ input, app, actor, scope, signal }` and name no process generic. No
  `transport/<surface>/` folders (`feature-shape: nested-transport`). The process mounts
  them; the module never does. The process-side mount runs on `createRestRuntime` /
  `createTrpcRuntime`; the older `createServiceApp`, `createServiceVersionedApp`,
  `createTrpcService`, `createProjectVersionedApp` and `mountProjectTransport` builders
  are deleted; a file still naming one is conversion debt (`legacy-transport-runtime`).
- `index.ts` of a server package exports the installer and the transport declarations.
  Never a repository, store, projection, service or app (`private-runtime-export`).
- Technical infrastructure (encryption, object storage, a clock, an audit sink) is a
  member of `<F>Infrastructure`, a plain interface declared beside the app and supplied by
  the process in `withInfrastructure`. A finished module has no `ports/` and no
  `adapters/` folder (`strict-port-module` still tolerates old ones until the lint flips).
  A peer module is never infrastructure: name its `*Api` token in `static dependencies`.
- Test builders live in `app/__tests__/<f>.fixture.ts`; there is no `fixtures/` and no
  `testing.ts` in a server package (`feature-shape: fixtures-directory`, `testing-entry`).
- A module exists to be installed: `<f>.server.ts` is its installer, `app/<f>.app.ts` its
  one app, and some process boots it with `createApp(...).withModule(<f>Server)`. A
  server package without them, or an installer no process boots while the root hand-builds
  the app, is conversion debt (`feature-shape: no-installer`, `no-app`,
  `installer-not-booted`). A process installs a module or does not; there is no
  `refusing<F>Feature()` twin (`feature-shape: refusing-composition`).
- Only `repositories/prisma/**` names Prisma, through `PrismaRepository.for("Model")`, and
  every query on a project model carries `projectId`. `as PrismaClient` is a lint failure.
- Utilities do not get a `utils/` folder; they belong to a service, a `rules/<name>.rules.ts`
  module, or the contract. Dots separate qualifiers, hyphens stay inside a name.
- A web package's public entries are flat files at `src/<entry>.ts`, each listed in its
  `package.json` `exports` and declared by the consuming module in
  `apps/ui/src/features/catalogue.json`. `./screens/<id>` and `./surfaces/<id>` are the
  older spelling, inventoried as `feature-shape: nested-web-entry` until the module
  converts.
- Never re-export for backwards compatibility; update the importers. Never `import()`
  inline; the exceptions are a web entry file's lazy screen loader and the SDK's CLI boot.
- Throw a `HandledError` only when the cause is known and the caller can act; register
  its code in `packages/handled-error/src/app-codes.ts` and its copy in `presentation.ts`.
- Module code never reads `process.env`. Config is a zod definition parsed once at the
  process entrypoint; cross-field rules go in `Config.group`, never a post-parse `assert*`.
- Every ClickHouse query filters `TenantId` first.
- Specs are written before code, every enforced scenario binds to a test with
  `/** @scenario "<title>" */`, and test descriptions are actions in `given`/`when`
  describes.

## The `modules` folder name

The tree reads `modules/` and `enterprise/modules/`, and the identifiers read
`Module*` (`defineModule`, `withModule`, `moduleApi`, `ModuleName`). The words a
lint policy id uses are the exception: `feature-source-layout`, `feature-catalogue`
and `feature-shape` are baseline keys and keep their names.

## Where the rules are written down

- `dev/docs/adr/133-composition-spec.md` (the installer, the app factory, transports,
  repositories, the six requirements) and
  `modules/annotation/adrs/001-annotation-service-boundary.md` (the reference)
- `packages/architecture-enforcer/adrs/002-versioned-strict-feature-layout.md` (the grammar),
  `packages/architecture-enforcer/adrs/001-feature-package-boundaries.md`,
  `packages/architecture-enforcer/adrs/004-frontend-feature-boundaries.md`
- `packages/oxlint/grammar/feature-layout-policy.mjs` (`SERVER_PATTERNS`,
  `CANONICAL_ARTIFACTS`, `SERVER_ARCHITECTURAL_QUALIFIERS`, `RULES_PATTERN`,
  `PURE_VALUE_CONSTRUCTORS`), consumed by `packages/architecture-enforcer/oxlint-plugin.mjs`
  and `packages/architecture-enforcer/src/feature-layout.ts`
- `packages/architecture-enforcer/src/feature-shape.ts` (the legacy-shape inventory),
  `feature-app-contract.ts`, `feature-app-factory.ts`, `feature-setup-infrastructure.ts`
  (the app and API shape), `frontend-ui-boundaries.ts` (`UI_LAYER_DEPENDENCIES`),
  `port-modules.ts` (`typed-prisma-seam` is an oxlint rule with no baseline of its own)
- `packages/architecture-enforcer/oxlint-plugin.mjs` and `packages/architecture-enforcer/oxlint.architecture.jsonc`
  (`prisma-containment`, `typed-prisma-seam`, `feature-source-layout`, `-filename`,
  `-subject`, `fallible-result-naming`, `layer-class`, and the rest; rendered in
  `dev/docs/lint-rules.md`)
- `modules/README.md`
- `dev/docs/best_practices/error-handling.md`, `dev/docs/best_practices/drawers.md`,
  `dev/docs/best_practices/react.md`, `dev/docs/best_practices/clickhouse-queries.md`
- `dev/docs/TESTING_PHILOSOPHY.md`, `specs/README.md`
- `dev/docs/adr/101-feature-package-surfaces.md`,
  `dev/docs/adr/102-runtime-composition-roots.md`,
  `dev/docs/adr/111-physical-application-workspaces.md`,
  `dev/docs/adr/112-singular-feature-ownership.md`,
  `dev/docs/adr/128-public-rest-and-internal-trpc.md`,
  `dev/docs/adr/130-the-api-router-type-is-declared.md`,
  `dev/docs/adr/132-secrets-are-not-config.md`

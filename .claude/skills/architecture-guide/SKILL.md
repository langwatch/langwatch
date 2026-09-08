---
name: architecture-guide
description: "The reference for the LangWatch repository layout: what apps/ui, apps/api, apps/worker and apps/tasks are, what a feature package is (contract/server/web), the server shape the annotation feature set (one installer, one app, private services, repository interfaces with Prisma and memory backends, flat REST and tRPC declarations), the web layer order (model, behavior, ui/elements, ui/blocks, ui/sections, flat entry files), how config, composition roots, UI install and specs work, and which architecture-lint rule enforces each. Read this whenever you touch anything under packages/features, packages/enterprise/features, apps/api/src/app, apps/api/src/features, apps/worker/src/app or apps/ui/src/features, or when a user asks where something should live, why a lint rule fired, what an app/service/repository is here, or how a feature is wired. The task skills feature-new, feature-extend, feature-wire, feature-audit, feature-move, api-rest-route, api-trpc-procedure, web-surface and spec-bind all build on it."
user-invocable: true
argument-hint: "[layer: contract | server | web | config | composition | install | testing | gates]"
---

# LangWatch architecture guide

The product is four Node applications — `apps/ui` (browser), `apps/api` (tRPC + REST +
SSE), `apps/worker` (queues, schedulers, projections) and `apps/tasks` (one-shot
programs) — plus the Go services `services/aigateway`, `services/nlpgo` and
`services/langyagent`. Applications hold no product code: they boot feature packages over
their own database, Redis and ClickHouse handles through `@langwatch/runtime-composition`.

A feature is a folder `packages/features/<name>/` that owns three workspace packages:

| Directory  | Package                      | Holds                                                                          |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `contract` | `@langwatch/<name>-contract` | zod schemas, portable types, `HandledError` subclasses, the callable `<Name>Api` |
| `server`   | `@langwatch/<name>-server`   | the installer, the app, private services and repositories, REST/tRPC declarations |
| `web`      | `@langwatch/<name>-web`      | screens, surfaces, hooks, pure view models (optional)                          |

The root is not a package. It holds `feature.json` (`{ "layoutVersion": 0 }`), `specs/`
and `adrs/`. Enterprise features mirror this under `packages/enterprise/features/<name>`;
`packages/enterprise/composition/{api,worker}` compose the backend halves, and enterprise
web packages install through `apps/ui/src/features/catalogue.json` like any other `*-web`.

**The reference feature is `annotation`** (`packages/features/annotation`, ADR-001 in its
`adrs/`, shared decision ADR-133). Every other feature is being converted to its shape;
`packages/architecture-lint/src/feature-shape-baseline.json` is the list of what each
feature still carries from the older shape, and it may only shrink. Copy annotation, not
the feature next to it. Pointed at any other feature, the task skills produce this same
shape: `feature-convert` closes a feature's entries kind by kind; `feature-new`,
`feature-extend`, `api-rest-route`, `api-trpc-procedure` and `web-surface` add to it.

```
packages/features/annotation/
├── feature.json · specs/ · adrs/
├── contract/src/
│   ├── annotation.api.ts            interface AnnotationApi + featureApi token
│   ├── annotation.schemas.ts · annotation-queue.schemas.ts · annotation-rest.schemas.ts · annotation-trpc.schemas.ts
│   ├── annotation.errors.ts · annotation-queue.errors.ts
│   └── annotation-*.types.ts · index.ts
├── server/src/
│   ├── annotation.server.ts         defineFeature("annotation").withRepositories(...).withApp(...).withTransports(...).build()
│   ├── index.ts                     exports the installer and the transport declarations, nothing else
│   ├── app/annotation.app.ts        class AnnotationApp implements AnnotationApi; owns the private services
│   ├── services/*.service.ts        one class per entity, each over its repository interface
│   ├── repositories/*.repository.ts interfaces · annotation.repositories.ts (the bundle) · annotation-repositories.registry.ts
│   ├── repositories/prisma/         prisma.*.repository.ts + prisma.annotation.repositories.ts
│   ├── repositories/memory/         memory.*.repository.ts + memory.annotation.repositories.ts
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
other half. Another feature imports only the owner's contract, names the owner's `*Api`
token in its app's `static dependencies`, and receives the owner's app at boot. Nobody
imports another feature's service or repository. `packages/features/catalogue.json` maps
every subject to exactly one owning feature; `feature-source-subject` fires when a
filename claims another feature's subject, and `FeatureName` (the type `defineFeature`
and `featureApi` accept) is generated from that catalogue.

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
  config modules, the root `.env`, `createApp(...).withPersistence().withProvided().withFeature().boot()`,
  the REST and tRPC mounts in `apps/api/src/features/<f>/`, the worker, producer-only
  eventing.
- `references/install.md`: the steps that put a screen in front of a user
  (catalogue.json, the private feature folder, `WebInstallation`, routes, feature-map.json).
- `references/testing.md`: specs first, `@scenario` binding, test levels, the annotation
  test layout (fixture beside the app, memory repositories, `createApiFixture` peers),
  the guards by name.
- `references/gates.md`: the exact commands every task skill ends with.

## The rules that bite most often

- The contract's capability is `<f>.api.ts`: one `interface <F>Api` of callable operations
  and `export const <F>Api = featureApi<<F>Api>("<f>")`. There is no abstract service in a
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
- Transports are inert declarations: `transport/<f>.rest.ts` and `transport/<f>.trpc.ts`
  built with `defineTransport(<F>Api)`, handlers inline beside verb, path, permission and
  schemas, reading `{ input, app, actor, scope }`. No `transport/<surface>/` folders
  (`feature-shape: nested-transport`). The process mounts them; the feature never does.
- `index.ts` of a server package exports the installer and the transport declarations.
  Never a repository, store, projection, service or app (`private-runtime-export`).
- A `ports/*.port.ts` is for technical infrastructure only (encryption, object storage, a
  clock) and is an abstract class ending in `Port` (`strict-port-module`). A peer feature
  is never a port: name its `*Api` token in `static dependencies`.
- Test builders live in `app/__tests__/<f>.fixture.ts`; there is no `fixtures/` and no
  `testing.ts` in a server package (`feature-shape: fixtures-directory`, `testing-entry`).
- A feature exists to be installed: `<f>.server.ts` is its installer, `app/<f>.app.ts` its
  one app, and some process boots it with `createApp(...).withFeature(<f>Server)`. A
  server package without them, or an installer no process boots while the root hand-builds
  the app, is conversion debt (`feature-shape: no-installer`, `no-app`,
  `installer-not-booted`). A process installs a feature or does not; there is no
  `refusing<F>Feature()` twin (`feature-shape: refusing-composition`).
- Only `repositories/prisma/**` names Prisma, through `PrismaRepository.for("Model")`, and
  every query on a project model carries `projectId`. `as PrismaClient` is a lint failure.
- Utilities do not get a `utils/` folder; they belong to a service, a `rules/<name>.rules.ts`
  module, or the contract. Dots separate qualifiers, hyphens stay inside a name.
- A web package's public entries are flat files at `src/<entry>.ts`, each listed in its
  `package.json` `exports` and declared by the consuming feature in
  `apps/ui/src/features/catalogue.json`. `./screens/<id>` and `./surfaces/<id>` are the
  older spelling, inventoried as `feature-shape: nested-web-entry` until the feature
  converts.
- Never re-export for backwards compatibility; update the importers. Never `import()`
  inline; the exceptions are a web entry file's lazy screen loader and the SDK's CLI boot.
- Throw a `HandledError` only when the cause is known and the caller can act; register
  its code in `packages/handled-error/src/app-codes.ts` and its copy in `presentation.ts`.
- Feature code never reads `process.env`. Config is a zod definition parsed once at the
  process entrypoint; cross-field rules go in `Config.group`, never a post-parse `assert*`.
- Every ClickHouse query filters `TenantId` first.
- Specs are written before code, every enforced scenario binds to a test with
  `/** @scenario "<title>" */`, and test descriptions are actions in `given`/`when`
  describes.

## Where the rules are written down

- `dev/docs/adr/133-composition-spec.md` (the installer, the app factory, transports,
  repositories, the six requirements) and
  `packages/features/annotation/adrs/001-annotation-service-boundary.md` (the reference)
- `packages/architecture-lint/adrs/002-versioned-strict-feature-layout.md` (the grammar),
  `packages/architecture-lint/adrs/001-feature-package-boundaries.md`,
  `packages/architecture-lint/adrs/004-frontend-feature-boundaries.md`
- `packages/lint-core/grammar/feature-layout-policy.mjs` (`SERVER_PATTERNS`,
  `CANONICAL_ARTIFACTS`, `SERVER_ARCHITECTURAL_QUALIFIERS`, `RULES_PATTERN`,
  `PURE_VALUE_CONSTRUCTORS`), consumed by `packages/architecture-lint/oxlint-plugin.mjs`
  and `packages/architecture-lint/src/feature-layout.ts`
- `packages/architecture-lint/src/feature-shape.ts` (the legacy-shape inventory),
  `feature-app-contract.ts`, `feature-app-factory.ts`, `feature-setup-infrastructure.ts`
  (the app and API shape), `frontend-ui-boundaries.ts` (`UI_LAYER_DEPENDENCIES`),
  `typed-prisma-seam.ts`, `port-modules.ts`
- `packages/architecture-lint/oxlint-plugin.mjs` and `.oxlintrc.architecture.json`
  (`prisma-containment`, `typed-prisma-seam`, `feature-source-layout`, `-filename`,
  `-subject`, `fallible-result-naming`, `layer-class`, and the rest; rendered in
  `dev/docs/lint-rules.md`)
- `packages/features/README.md`
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

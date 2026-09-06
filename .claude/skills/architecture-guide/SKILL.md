---
name: architecture-guide
description: "The reference for the LangWatch repository layout: what apps/ui, apps/api, apps/worker and apps/tasks are, what a feature package is (contract/server/web), the server folder grammar (app, services, rules, ports, repositories, adapters, transport, tasks), the web layer order (model, behavior, ui/elements, ui/blocks, ui/sections, screens, surfaces), how config, composition roots, UI install and specs work, and which architecture-lint rule enforces each. Read this whenever you touch anything under packages/features, packages/enterprise/features, apps/api/src/app, apps/api/src/features, apps/worker/src/app or apps/ui/src/features, or when a user asks where something should live, why a lint rule fired, what a port/adapter/repository is here, or how a feature is wired. The task skills feature-new, feature-extend, feature-wire, feature-audit, feature-move, api-rest-route, api-trpc-procedure, web-surface and spec-bind all build on it."
user-invocable: true
argument-hint: "[layer: contract | server | web | config | composition | install | testing | gates]"
---

# LangWatch architecture guide

The product is four Node applications — `apps/ui` (browser), `apps/api` (tRPC + REST +
SSE), `apps/worker` (queues, schedulers, projections) and `apps/tasks` (one-shot
programs) — plus the Go services `services/aigateway` and `services/nlpgo`. Applications
hold no product code: they compose feature packages over their own database, Redis and
ClickHouse handles.

A feature is a folder `packages/features/<name>/` that owns three workspace packages:

| Directory  | Package                      | Holds                                                                |
| ---------- | ---------------------------- | -------------------------------------------------------------------- |
| `contract` | `@langwatch/<name>-contract` | zod schemas, commands, queries, events, errors, the abstract service |
| `server`   | `@langwatch/<name>-server`   | services, private persistence, ports, adapters, transports, tasks    |
| `web`      | `@langwatch/<name>-web`      | screens, surfaces, hooks, pure view models (optional)                |

The root is not a package. It holds `feature.json` (`{ "layoutVersion": 0 }`), `specs/`
and `adrs/`. Enterprise features mirror this under `packages/enterprise/features/<name>`;
`packages/enterprise/composition/{api,worker}` compose the backend halves, and enterprise
web packages install through `apps/ui/src/features/catalogue.json` like any other `*-web`.

Dependency direction, with no exceptions:

```
apps/ui     -> @langwatch/<f>-web    -> @langwatch/<f>-contract
apps/api    -> @langwatch/<f>-server -> @langwatch/<f>-contract
apps/worker -> @langwatch/<f>-server -> @langwatch/<f>-contract
apps/tasks  -> @langwatch/<f>-server -> @langwatch/<f>-contract
```

web never imports server; server never imports web; contract imports no framework and no
other half. Another feature imports only the owner's contract and receives the owner's
concrete service through composition. `packages/features/catalogue.json` maps every
subject to exactly one owning feature; `feature-source-subject` fires when a filename
claims another feature's subject.

## Which reference to read

Read the one that matches the layer you are about to touch. Each is short.

- `references/contract.md`: what may live in `contract/src`, zod-with-infer, HandledError
  subclasses with stable codes, the REST endpoint declaration, the api-map.
- `references/server.md`: the closed folder grammar, filename rules, prisma containment,
  the typed Prisma seam, transports and their surfaces, ports versus adapters, rules
  modules, the app object.
- `references/web.md`: the layer order and import matrix, screens versus surfaces versus
  pages, host ports, drawers, the closed public entry.
- `references/config-composition.md`: `RuntimeConfig`, the per-process config modules,
  the root `.env`, the public app config meta tag, composition roots in apps/api,
  apps/worker and apps/tasks, named absences, producer-only eventing, the worker
  installer and the frozen job registry.
- `references/install.md`: the steps that put a screen in front of a user
  (catalogue.json, the private feature adapter, `uiFeature`, the route table,
  feature-map.json).
- `references/testing.md`: specs first, `@scenario` binding, test levels, per-package
  runs, the guards by name and where each rule is implemented.
- `references/gates.md`: the exact commands every task skill ends with.

## The rules that bite most often

- A server package with no `services/<name>.service.ts` fails lint. Utilities do not get
  a `utils/` folder; they belong to a service, a `rules/<name>.rules.ts` module, an
  adapter or the contract.
- Dots separate architectural qualifiers, hyphens stay inside a name:
  `prisma.agent.repository.ts` is valid, `prisma-agent.repository.ts` is not.
- Only `repositories/prisma/**` and `adapters/postgres.*.adapter.ts` may name
  `PrismaClient`, and they receive it typed from the composition root. `as PrismaClient`
  anywhere in a feature is a lint failure.
- `index.ts` of a server package never re-exports a repository, store or projection.
- A web package exports only `./screens/<owner>` and `./surfaces/<id>`.
- Never re-export for backwards compatibility; update the importers.
- Never `import()` inline; the only exceptions are a `screens/*/index.ts` lazy page module
  and the SDK's CLI boot path.
- A missing collaborator is named at boot (`absent("no-database")`, `without*()`,
  `Unavailable*`), never stubbed with something that answers 500.
- Throw a `HandledError` only when the cause is known and the caller can act; register
  its code in `packages/handled-error/src/app-codes.ts` and its copy in `presentation.ts`.
- Every ClickHouse query filters `TenantId` first; every Prisma query on a project model
  carries `projectId`.
- New public HTTP goes in `transport/public-rest/` with the `RestService` builder and a
  contract-declared endpoint (ADR-128). `transport/api-rest/` is the compatibility
  surface; extend it only to keep an existing URL working.
- A web api-map never names `AppRouter` (ADR-130); it types its slots from contract
  `*Input` / `*Output`.
- Specs are written before code, every enforced scenario binds to a test with
  `/** @scenario "<title>" */`, and test descriptions are actions in `given`/`when`
  describes.

## Where the rules are written down

- `packages/architecture-lint/adrs/002-versioned-strict-feature-layout.md` (the grammar)
- `packages/architecture-lint/adrs/001-feature-package-boundaries.md`,
  `packages/architecture-lint/adrs/004-frontend-feature-boundaries.md`
- `packages/lint-core/grammar/feature-layout-policy.mjs` (`SERVER_PATTERNS`,
  `CANONICAL_ARTIFACTS`, `SERVER_ARCHITECTURAL_QUALIFIERS`, `RULES_PATTERN`,
  `PURE_VALUE_CONSTRUCTORS`), consumed by
  `packages/architecture-lint/oxlint-plugin.mjs` and
  `packages/architecture-lint/src/feature-layout.ts`,
  `packages/architecture-lint/src/frontend-ui-boundaries.ts` (`UI_LAYER_DEPENDENCIES`),
  `packages/architecture-lint/src/typed-prisma-seam.ts`,
  `packages/architecture-lint/src/port-modules.ts`
- `packages/architecture-lint/oxlint-plugin.mjs` and `.oxlintrc.architecture.json`
  (`prisma-containment`, `typed-prisma-seam`, `feature-source-layout`, `-filename`,
  `-subject`, `fallible-result-naming`, `layer-class`, and the rest)
- `packages/features/README.md`
- `dev/docs/best_practices/service-repository-adapter-port.md`,
  `dev/docs/best_practices/error-handling.md`, `dev/docs/best_practices/drawers.md`,
  `dev/docs/best_practices/react.md`, `dev/docs/best_practices/clickhouse-queries.md`
- `dev/docs/TESTING_PHILOSOPHY.md`, `specs/README.md`
- `dev/docs/adr/101-feature-package-surfaces.md`,
  `dev/docs/adr/102-runtime-composition-roots.md`,
  `dev/docs/adr/111-physical-application-workspaces.md`,
  `dev/docs/adr/112-singular-feature-ownership.md`,
  `dev/docs/adr/128-public-rest-and-internal-trpc.md`,
  `dev/docs/adr/130-the-api-router-type-is-declared.md`

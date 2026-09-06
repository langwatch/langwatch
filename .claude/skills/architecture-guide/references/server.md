# Server packages

`packages/features/<name>/server` is `@langwatch/<name>-server`. `apps/api`, `apps/worker`
and `apps/tasks` all compose from it. A request enters through a transport, hits the
feature's app object, which calls services; services use repositories and ports; adapters
bind ports and repositories to the process's real infrastructure.

```
transport/public-rest ─┐
transport/api-rest    ─┼─▶ app/<f>.app.ts ─▶ services/*.service.ts ─▶ repositories/* (abstract)
transport/api-trpc    ─┤                            │                       └─ repositories/prisma/*
transport/api-mcp     ─┘                            └─▶ ports/*.port.ts ◀── adapters/*.adapter.ts
```

## The closed grammar (`server/src`)

`SERVER_PATTERNS` and `RULES_PATTERN` in
`packages/lint-core/grammar/feature-layout-policy.mjs`, enforced by
`packages/architecture-lint/oxlint-plugin.mjs`, with
`NAME = [a-z0-9]+(?:-[a-z0-9]+)*`:

```
index.ts                                       exports services + adapters (never repos)
testing.ts
app/<name>.app.ts
fixtures/<name>.fixture.ts
services/<name>.service.ts                     REQUIRED: at least one
rules/<name>.rules.ts                          pure functions and constants, no clock, no I/O
ports/<name>.port.ts
repositories/<name>[.<name>].repository.ts     the abstract repository
repositories/<adapter>/<adapter>.<name>.repository.ts   prisma/ eventing/ routed/ clickhouse/
repositories/<adapter>/<name>.mapper.ts
stores/<name>.store.ts · stores/<adapter>/<adapter>.<name>.store.ts
projections/<name>.projection.ts
subscribers/<name>.subscriber.ts
processes/<name>.process.ts
intents/<name>.intent.ts
adapters/<name>[.<name>].adapter.ts
transport/<surface>/<name>.api.ts
migrations/<name>-import.<name>.migration.ts
tasks/<name>.task.ts                           a one-shot program composed by apps/tasks
```

Transport surfaces in use: `public-rest` (the ADR-128 shape, 2 features), `api-rest` (34),
`api-trpc` (43), `api-mcp` (2), `api-ws` (2), `better-auth` (1).

There is no `composition/`, `registration/`, `lifecycle/`, `eventing/`, `utils/`,
`helpers/`, `lib/` or `domain/`. Their behaviour belongs to a service, a rules module, a
projection, an adapter, or the application's composition root; portable domain code
belongs in the contract. Anything under `__tests__/` at any depth is exempt from the
grammar. Server packages declare `"imports": { "#*": "./src/*.ts" }` so internal imports
read `import { SecretApp } from "#app/secret.app"`.

A `rules/` module is pure: functions and constants, no `new Date()`, no client, no
collaborator. `PURE_VALUE_CONSTRUCTORS` in `feature-layout-policy.mjs` is the list of
built-ins it may construct.

## Filenames

Lower-case kebab. Dots separate architectural qualifiers, hyphens stay inside a name.
Qualifiers (`SERVER_ARCHITECTURAL_QUALIFIERS`): `clickhouse, eventing, in-memory, ledger,
memory, postgres, prisma, redis, routed`. Artifacts (`CANONICAL_ARTIFACTS`): `adapter,
api, commands, errors, events, intent, migration, port, process, projection, queries,
repository, rules, service, store, subscriber, task`.

- `prisma.agent.repository.ts` yes; `prisma-agent.repository.ts` no.
- `postgres.secret.adapter.ts`, `eventing.scim-sync-ledger.adapter.ts`,
  `aes-gcm.secret-encryption.adapter.ts`.
- Tests: `<name>.<unit|integration|e2e>.test.ts` inside `__tests__/`.

## Module shape

- `.service.ts`, `.store.ts`, `.projection.ts`, `.api.ts`, `.migration.ts`, `.task.ts`
  export the class of the same name. Concrete runtime classes expose `static create(...)`.
- Ordinary methods return a value or throw the domain error. Only `try*` methods return
  `null` or `undefined`; `require*` is forbidden (`fallible-result-naming`).
- Repositories use `findAll` / `findById`; services use `getAll` / `getById`.
- Parameters are named objects: `fn({ a, b })`.
- Business logic (validation, guards) lives in the service, not the transport.

## Layers

**app/`<f>`.app.ts**: one class composed from the feature's own services and ports, that
every transport calls, so a REST handler and a tRPC procedure invoke the same operation.
Authorization checks belong here (`packages/features/authz/server/src/app/authz.app.ts`
is the reference).

**services/**: the behaviour. Owns validation and guards, orchestrates repositories and
ports, throws the contract's errors, implements the contract's abstract service.

**repositories/**: private persistence. An abstract `<name>.repository.ts` and one
implementation per qualifier folder. Never exported from `index.ts`
(`private-runtime-export`).

**ports/**: an abstract class for a capability the feature needs but does not own:
encryption, storage, a clock, another feature's service. `strict-port-module` requires a
real abstract `*Port` class, not a type alias. A port with one implementation that
production always supplies is over-abstraction; delete the port and take the concrete
dependency.

**adapters/**: bind ports and repositories to infrastructure. The Postgres adapter takes
the composition root's `PrismaClient` and builds the Prisma repository; eventing adapters
bind a port to a pipeline. Adapters and services are what `index.ts` exports.

**transport/**: one folder per door. A transport parses input with the contract's
schemas, calls the app or service, and maps contract errors at the boundary. It never
touches a repository, constructs a service or reads `process.env`
(`api-transport-*` rules in `packages/architecture-lint/src/api-transport-boundaries.ts`).

**tasks/**: a one-shot program extending `Task` from `@langwatch/task`, listed in
`apps/tasks/src/tasks.catalogue.ts` and run with
`pnpm --filter @langwatch/tasks task <name>`. A task the API's own boot graph is required
for stays in `apps/api/src/tasks/` instead.

## Prisma containment and the typed seam

Only `repositories/prisma/**` and `adapters/postgres.*.adapter.ts` may import the
generated Prisma client (`prisma-containment`). The composition root already holds a
typed `PrismaClient`; pass it through:

```ts
export class PostgresSecretAdapter {
  static create({ prisma }: { prisma: PrismaClient }): PostgresSecretAdapter {
    return new PostgresSecretAdapter(PrismaSecretRepository.create({ prisma }));
  }
}
```

`as PrismaClient` anywhere in feature source and `database: object` on a `.create(`
parameter list are rejected by `typed-prisma-seam`. Every query on a project-level model
includes `projectId`; the tenancy middleware rejects the rest. Read
`dev/docs/best_practices/service-repository-adapter-port.md` for the full shape.

## Transports

**Public REST** (`transport/public-rest/<subject>.api.ts`, ADR-128) is a class with
`static create()` and `install(api: RestService<App>)` that chains
`.get(path, version, endpoint => endpoint.withInput().withOutput().withPermission(…).withDocs().handle())`.
The input, output and permission of each operation are declared in the **contract**
(`packages/features/secret/contract/src/secret.queries.ts` `secretPublicRest`). The
process mounts it through a family class in `apps/api/src/api-<f>-rest.feature.ts`. The
`api-rest-route` skill is the recipe.

**Legacy REST** (`transport/api-rest/<subject>.api.ts`) is a Hono app built with
`@langwatch/api/rest` (`validator`, `SecuredApp`, `AppRestProjectVariables`,
`describeRoute`), registered by
`apps/api/src/app-rest/app-rest.packaged-families.ts`. It is a compatibility surface:
extend it only to keep an existing URL working.

Errors are thrown, never hand-rolled as `c.json({ error }, status)`; the framework's
`onError` serialises a `HandledError`. The published OpenAPI document
(`apps/api/src/features/discovery/openapi-document.json`) is generated by the
`openapi-generate` task; do not hand-edit it.

**tRPC** (`transport/api-trpc/<subject>.api.ts`) is a router fragment built with
`createTrpcService` from `@langwatch/api/trpc`, handed its root, its authenticated
procedure and its policy decorator by a mount in
`apps/api/src/features/<f>/<f>-trpc.mount.ts`. The `api-trpc-procedure` skill is the
recipe.

## ClickHouse and eventing

Every ClickHouse query starts `WHERE TenantId = {tenantId:String}` and filters the
partition key column when a date range exists; read
`dev/docs/best_practices/clickhouse-queries.md` first. On the API, eventing is producer
only: a service may send a command on a pipeline; process managers, appends and folds
run in the worker. A `subscribers/*.subscriber.ts` must be idempotent
(`eventing-subscriber-idempotency`).

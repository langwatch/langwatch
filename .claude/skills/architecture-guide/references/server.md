# Server packages

`packages/features/<name>/server` is `@langwatch/<name>-server`. Both `apps/api` and
`apps/worker` compose from it. A request enters through a transport, hits the feature's
app object, which calls services; services use repositories and ports; adapters bind
ports and repositories to the process's real infrastructure.

```
transport/api-rest ─┐
transport/api-trpc ─┼─▶ app/<f>.app.ts ─▶ services/*.service.ts ─▶ repositories/* (abstract)
transport/api-mcp  ─┘                            │                       └─ repositories/prisma/*
                                                 └─▶ ports/*.port.ts ◀── adapters/*.adapter.ts
```

## The closed grammar (`server/src`)

`SERVER_PATTERNS` in `packages/architecture-lint/src/feature-layout.ts`, with
`NAME = [a-z0-9]+(?:-[a-z0-9]+)*`:

```
index.ts                                       exports services + adapters (never repos)
testing.ts
app/<name>.app.ts
fixtures/<name>.fixture.ts
services/<name>.service.ts                     REQUIRED: at least one
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
transport/<surface>/<name>.api.ts              surfaces: api-rest, api-trpc, api-mcp, better-auth
migrations/<name>-import.<name>.migration.ts
```

There is no `composition/`, `registration/`, `lifecycle/`, `eventing/`, `utils/`,
`helpers/`, `lib/` or `domain/`. Their behaviour belongs to a service, a projection, an
adapter, or the application's composition root; portable domain code belongs in the
contract. Anything under `__tests__/` at any depth is exempt from the grammar. Server
packages declare `"imports": { "#*": "./src/*.ts" }` so internal imports read
`import { SecretApp } from "#app/secret.app"`.

## Filenames

Lower-case kebab. Dots separate architectural qualifiers, hyphens stay inside a name.
Qualifiers: `clickhouse, eventing, in-memory, ledger, memory, postgres, prisma, redis,
routed`. Artifacts: `adapter, api, commands, errors, events, intent, migration, port,
process, projection, queries, repository, service, store, subscriber`.

- `prisma.agent.repository.ts` yes; `prisma-agent.repository.ts` no.
- `postgres.secret.adapter.ts`, `eventing.scim-sync-ledger.adapter.ts`,
  `aes-gcm.secret-encryption.adapter.ts`.
- Tests: `<name>.<unit|integration|e2e>.test.ts` inside `__tests__/`.

## Module shape

- `.service.ts`, `.store.ts`, `.projection.ts`, `.api.ts`, `.migration.ts` export the
  class of the same name. Concrete runtime classes expose `static create(...)`.
- Ordinary methods return a value or throw the domain error. Only `try*` methods return
  `null` or `undefined`; `require*` is forbidden (`fallible-result-naming`).
- Repositories use `findAll` / `findById`; services use `getAll` / `getById`.
- Parameters are named objects: `fn({ a, b })`.
- Business logic (validation, guards) lives in the service, not the transport.

## Layers

**app/`<f>`.app.ts**: one class composed from the feature's own services and ports, that
both transports call, so a REST handler and a tRPC procedure invoke the same operation.
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
touches a repository.

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

REST (`transport/api-rest/<subject>.api.ts`) is a Hono app built with `@langwatch/api/rest`
(`validator as zValidator`, `baseResponses`, `successSchema`, `SecuredApp`,
`AppRestProjectVariables`, `describeRoute` from hono-openapi). Errors are thrown, never
hand-rolled as `c.json({ error }, status)`; the framework's `onError` serialises a
`HandledError`. The app is registered by `apps/api/src/app-rest/app-rest.packaged-families.ts`.
The published OpenAPI document is generated from these declarations by the
openapi-document task; do not hand-edit it.

tRPC (`transport/api-trpc/<subject>.api.ts`) is a router fragment built with the runtime
in `packages/api/src/trpc`; it is handed its collaborators by an
`api-trpc-collaborators.<group>.composition.ts` root and reached by the browser through
the feature's api-map. `api-transport-*` rules forbid a service locator, a transport
constructing its own services, and a transport importing outside the allowed boundary.

## ClickHouse and eventing

Every ClickHouse query starts `WHERE TenantId = {tenantId:String}` and filters the
partition key column when a date range exists; read
`dev/docs/best_practices/clickhouse-queries.md` first. On the API, eventing is producer
only: a service may send a command on a pipeline; process managers, appends and folds
run in the worker. A `subscribers/*.subscriber.ts` must be idempotent
(`eventing-subscriber-idempotency`).

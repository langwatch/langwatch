# Server packages

`packages/features/<name>/server` is `@langwatch/<name>-server`. `apps/api`, `apps/worker`
and `apps/tasks` all boot it. A request enters through a transport declaration the
process mounted, reaches the feature's one app, which calls its private services;
services use repository interfaces; the repository backend was chosen once at boot.
The reference is `packages/features/annotation/server`.

```
transport/<f>.rest.ts ─┐                                     ┌─ services/<f>.service.ts ──▶ repositories/<f>.repository.ts (interface)
transport/<f>.trpc.ts ─┼─▶ app/<f>.app.ts (implements <F>Api)┼─ services/<f>-score.service.ts ─▶ …                    ▲
worker jobs            ─┘         │                          └─ services/<f>-queue.service.ts ─▶ …      repositories/prisma/prisma.<f>.repository.ts
                                  │ static dependencies                                                 repositories/memory/memory.<f>.repository.ts
                                  ▼
                        peer *Api tokens (ProjectApi, UserApi, AuthzApi, …), provided by the process
```

## The closed grammar (`server/src`)

`SERVER_PATTERNS` and `RULES_PATTERN` in
`packages/lint-core/grammar/feature-layout-policy.mjs`, enforced by
`packages/architecture-lint/oxlint-plugin.mjs`, with `NAME = [a-z0-9]+(?:-[a-z0-9]+)*`.
The reference shape:

```
index.ts                                              exports <f>Server and the transport declarations, nothing else
<f>.server.ts                                         the installer (defineFeature)
app/<f>.app.ts                                        REQUIRED: the one class implementing <F>Api
app/__tests__/<f>.fixture.ts                          test builders: the app over memory repositories, peer fixtures
services/<name>.service.ts                            REQUIRED: at least one; one class per entity
rules/<name>.rules.ts                                 pure functions and constants, no clock, no I/O
repositories/<name>.repository.ts                     an interface per entity
repositories/<f>.repositories.ts                      the bundle interface { annotations, scores, queues, … }
repositories/<f>-repositories.registry.ts             defineRepositories({ postgres, memory })
repositories/prisma/prisma.<name>.repository.ts       the only Prisma imports
repositories/prisma/prisma.<f>.repositories.ts        prismaRepositories({ … })
repositories/memory/memory.<name>.repository.ts       the memory twin of every Prisma repository
repositories/memory/memory.<f>.repositories.ts        the memory bundle (static requires = [], static create())
repositories/memory/memory.<name>.database.ts         shared in-memory tables, when several twins share rows
transport/<f>.rest.ts                                 defineRestRouter(<F>Api).withNamespace("<f>s").withVersion(…).get(…)….build()
transport/<f>.trpc.ts · transport/<f>-<part>.trpc.ts  defineTrpcRouter(<F>Api, <f>Trpc).procedure(name).withPermission(…).handle(…)….build(), one file per namespace
ports/<name>.port.ts                                  abstract class …Port for TECHNICAL infrastructure only
stores/ · projections/ · subscribers/ · processes/ · intents/    eventing roles, unchanged
tasks/<name>.task.ts                                  a one-shot program composed by apps/tasks
migrations/<name>-import.<name>.migration.ts
```

Still parsed by the grammar but inventoried by `feature-shape` and gone when a feature
converts: `testing.ts`, `fixtures/`, `adapters/postgres.*.adapter.ts` (and any other
persistence adapter), `transport/<surface>/<name>.api.ts` (`api-trpc`, `api-rest`,
`public-rest`, `api-mcp`, `api-ws`). Do not add new ones.

There is no `composition/`, `registration/`, `lifecycle/`, `eventing/`, `utils/`,
`helpers/`, `lib/` or `domain/`. Anything under `__tests__/` at any depth is exempt from
the grammar. Server packages declare `"imports": { "#*": { "types": "./dist/*.d.ts", "default": "./src/*.ts" } }`
so internal imports read `import { AnnotationApp } from "#app/annotation.app"`.

## Filenames

Lower-case kebab. Dots separate architectural qualifiers, hyphens stay inside a name.
Qualifiers (`SERVER_ARCHITECTURAL_QUALIFIERS`): `clickhouse, eventing, in-memory, ledger,
memory, postgres, prisma, redis, routed`. Artifacts (`CANONICAL_ARTIFACTS`): `adapter,
api, app, commands, errors, events, intent, migration, port, process, projection, queries,
repository, rules, service, store, subscriber, task`.

- `prisma.annotation-queue.repository.ts` yes; `prisma-annotation-queue.repository.ts` no.
- `memory.annotation-queue.database.ts`, `annotation-repositories.registry.ts`,
  `annotation-score.trpc.ts`.
- Tests: `<name>.<unit|integration|e2e>.test.ts` inside a colocated `__tests__/`.

## Module shape

- `.app.ts`, `.service.ts`, `.repository.ts` (under a backend folder), `.store.ts`,
  `.projection.ts`, `.task.ts` export the class of the same name. Concrete runtime
  classes have a private constructor and `static create(...)`.
- Ordinary methods return a value or throw the domain error. Absence is a `find*` method
  returning `undefined`. `try*` and `require*` are not part of the vocabulary
  (`fallible-result-naming`).
- Repositories use `findAll` / `findById` / `create` / `update` / `delete` and specific
  reads (`findBySlug`, `listPage`); the app and services use the API's RPC verbs.
- Parameters are named objects: `fn({ a, b })`. Services parse their input with the
  contract schema before touching a repository (`schema.parse(input)`).
- Business logic (validation, guards, reference checks) lives in the app or a service,
  never in a transport or a repository.

## Layers

**`<f>.server.ts`, the installer**

```ts
export const annotationServer = defineFeature("annotation")
  .withRepositories(annotationRepositories)
  .withApp(AnnotationApp)
  .withTransports(annotationRest, annotationTrpcTransport, annotationScoreTrpcTransport)
  .build();
```

One installer per feature, reused by every process role. `defineFeature` takes the
catalogue name; the framework derives the public namespace (`annotation` → `annotations`
for REST under `/api/v1`, and the tRPC namespace) so the feature writes neither. A feature
without persistence omits `.withRepositories`; a feature with a worker contribution adds
it here too. `index.ts` exports this and the transport declarations only.

**`app/<f>.app.ts`**: the one public object.

```ts
type AnnotationSetup = FeatureSetup<typeof AnnotationApp.dependencies, never, undefined, AnnotationRepositories>;

export class AnnotationApp implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = { projects: ProjectApi, organizations: OrganizationApi, users: UserApi, traces: TraceApi, permissions: AuthzApi };

  #annotations: AnnotationService;
  #scores: AnnotationScoreService;
  #projects: ProjectApi;

  private constructor(repositories: AnnotationRepositories, dependencies: AnnotationSetup["dependencies"]) {
    this.#annotations = AnnotationService.create({ repository: repositories.annotations });
    this.#scores = AnnotationScoreService.create({ repository: repositories.scores });
    this.#projects = dependencies.projects;
  }

  static create({ repositories, dependencies }: AnnotationSetup): AnnotationApp {
    return new AnnotationApp(repositories, dependencies);
  }

  create(input: CreateAnnotationInput) { return this.#annotations.create(input); }
  // … one method per API operation; orchestration across services and peers lives here
}
```

`FeatureSetup<Dependencies, Infrastructure, Config, Repositories>`: peers arrive typed
from the declared tokens, technical infrastructure (an object storage client, an
encryption port) as the second parameter, validated feature config as the third,
repositories as the fourth. Peer enrichment (users, traces), reference validation,
authorization decisions through `AuthzApi`, review workflows and side effects across
entities all live in the app. Thin forwarding methods are intentional: they are the
public boundary. Nothing on the instance is public except the API's operations
(`feature-app-contract`, `feature-app-factory`).

**`services/`**: one class per entity, over its repository interface.

```ts
export class AnnotationScoreService {
  #repository: AnnotationScoreRepository;
  private constructor(repository: AnnotationScoreRepository) { this.#repository = repository; }
  static create(options: { repository: AnnotationScoreRepository }): AnnotationScoreService {
    return new AnnotationScoreService(options.repository);
  }
  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    return this.#repository.upsertScore(upsertAnnotationScoreInputSchema.parse(input));
  }
}
```

A service owns mapping, validation and its entity's errors. It receives repositories
only: no peer APIs, no other services (repository count does not decide service count;
the queue service takes two repositories). Services are private to the app and never
exported.

**`repositories/`**: interfaces at the top, one file per backend below.

```ts
// repositories/annotation.repositories.ts
export interface AnnotationRepositories {
  readonly annotations: AnnotationRepository;
  readonly scores: AnnotationScoreRepository;
}

// repositories/annotation-repositories.registry.ts
export const annotationRepositories = defineRepositories({
  postgres: PostgresAnnotationRepositories,   // repositories/prisma/prisma.annotation.repositories.ts
  memory: MemoryAnnotationRepositories,       // repositories/memory/memory.annotation.repositories.ts
});

// repositories/prisma/prisma.annotation.repositories.ts
export const PostgresAnnotationRepositories = prismaRepositories({
  annotations: PrismaAnnotationRepository,
  scores: PrismaAnnotationScoreRepository,
});

// repositories/prisma/prisma.annotation-score.repository.ts
export class PrismaAnnotationScoreRepository
  extends PrismaRepository.for("AnnotationScore")
  implements AnnotationScoreRepository
{
  static readonly create = this.factory((prisma) => new PrismaAnnotationScoreRepository(prisma));
  async listScoreNames(input: ListAnnotationScoreNamesInput) {
    return this.prisma.annotationScore.findMany({ where: { projectId: input.projectId }, select: { id: true, name: true } });
  }
}

// repositories/memory/memory.annotation.repositories.ts
export class MemoryAnnotationRepositories {
  static readonly requires = [] as const;
  static create(): AnnotationRepositories {
    const database = MemoryAnnotationQueueDatabase.create();
    return { annotations: MemoryAnnotationRepository.create(), scores: MemoryAnnotationScoreRepository.create({ memory: database }) };
  }
}
```

The process selects a backend once with `.withPersistence("postgres", { prisma })` or
`.withPersistence("memory", {})`; boot validates the factory's declared infrastructure
before construction and never falls back to memory. A factory contains construction
only. Every Prisma repository has a memory twin with the same observable behaviour, so
the app's tests run without a database and a test may replace one repository in the
bundle. Repositories are never exported from `index.ts` (`private-runtime-export`).

**Prisma containment and the typed seam.** Only `repositories/prisma/**` imports Prisma
(`prisma-containment`), through `PrismaRepository.for("Model", …)` from
`@langwatch/prisma-client`, which declares the model delegates the repository owns
(`prisma-table-ownership` checks two features never claim one table) and hands
`this.prisma` typed. Rows are mapped to contract values before returning and uncertain
JSON columns are parsed with the contract schema. `as PrismaClient` and `database: object`
are rejected by `typed-prisma-seam`. Every query on a project-level model includes
`projectId`. Prisma errors are classified with `@langwatch/prisma-client/errors`
(`isRecordNotFoundError`) and rethrown as the contract's handled error.

**`ports/`**: technical infrastructure only, an abstract class ending in `Port`
(`strict-port-module`): encryption, object storage, a clock. It arrives through the
app's `FeatureSetup` infrastructure parameter, provided by the process with
`.withInfrastructure({...})`. A peer feature is never a port. A port with one
implementation that production always supplies is over-abstraction; take the concrete
dependency.

**`rules/`**: a pure module of functions and constants, no `new Date()`, no client, no
collaborator. `PURE_VALUE_CONSTRUCTORS` in `feature-layout-policy.mjs` lists the
built-ins it may construct.

**`transport/`**: inert declarations. A transport declares its permission, calls exactly
one app operation and returns a value the declared output schema accepts. It never
touches a repository, constructs a service, reads a header, or hand-rolls a response
(`api-transport-*`, `no-raw-hono-mount`), and it names no process generic
(`TContext`, `TRoot`, a mount type): the process mount binds the framework's request
context on its own side.

A tRPC procedure is declared **once, in the contract** (`contract/src/<f>.trpc.ts`,
`defineTrpcContract` from `@langwatch/api/contract`: name, kind, input, output) and the
server binds only what the contract could not say (`defineTrpcRouter` from
`@langwatch/api/trpc`: permission and handler). `.procedure(name)` selects a declared
member; an unknown name, a duplicate, a missing implementation at `build()`, `handle`
before an access decision, or data returned from a void procedure does not compile. REST
is one complete endpoint per route, in the server (`defineRestRouter` from
`@langwatch/api/rest`); a route without output answers 204, and params must match the
path exactly. The design is `packages/api/adrs/20260908-transport-declaration-split.md`.

```ts
// contract/src/annotation-score.trpc.ts
export const annotationScoreTrpc = defineTrpcContract("annotationScore")
  .query("getAll").withInput(annotationScoreProjectScopeSchema).withOutput(annotationScoreSchema.array())
  .mutation("delete").withInput(annotationScoreScopeSchema).withOutput(annotationScoreSchema)
  .build();

// server/src/transport/annotation-score.trpc.ts
export const annotationScoreTrpcTransport = defineTrpcRouter(AnnotationApi, annotationScoreTrpc)
  .procedure("getAll").withPermission("annotations:view")
  .handle(async ({ app, input }) => app.listScores({ projectId: input.projectId }))
  .procedure("delete").withPermission("annotations:delete")
  .handle(async ({ app, input }) => app.deleteScore({ id: input.scoreId, projectId: input.projectId }))
  .build();

// server/src/transport/annotation.rest.ts
export const annotationRest = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)
  .get("/:id", "getAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:view")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Get an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => ({ data: await app.getById({ id: input.id, projectId: scope.id }) }))
  .build();
```

Handlers receive `{ input, app, actor, scope, signal }`: `input` is the merged, parsed
params/query/body; `scope` is the authorized target (`{ tier: "project", id }`); `actor`
is the authenticated principal. Input and output schemas are mandatory; a no-content
route declares no output and returns `void`. The `api-rest-route` and `api-trpc-procedure`
skills are the recipes; `references/config-composition.md` says how a process mounts a
declaration.

**`tasks/`**: a one-shot program extending `Task` from `@langwatch/task`, listed in
`apps/tasks/src/tasks.catalogue.ts` and run with
`pnpm --filter @langwatch/tasks task <name>`. A task the API's own boot graph is required
for stays in `apps/api/src/tasks/` instead.

## Tests inside the package

```
app/__tests__/<f>.fixture.ts                        createAnnotationTestApp({ repositories?, dependencies? }) over MemoryAnnotationRepositories
app/__tests__/<f>-installation.unit.test.ts         createApp(...).withPersistence("memory", {}).withProvided(...).withFeature(<f>Server).boot({ role })
app/__tests__/<f>-boundary.unit.test.ts             peer errors propagate, references validated, side effects best-effort
services/__tests__/<name>.service.unit.test.ts
repositories/memory/__tests__/memory.<name>.repository.unit.test.ts
repositories/prisma/__tests__/prisma.<name>.repository.unit.test.ts · *.integration.test.ts (real Postgres, own vitest.integration.config.ts)
transport/__tests__/<f>.rest.integration.test.ts · <f>.trpc.*.test.ts
```

Peers are `createApiFixture<ProjectApi>({ … })` from `@langwatch/test-harness/api-fixture`:
a method the test did not configure throws when called, so a new dependency cannot pass
silently. See `references/testing.md`.

## ClickHouse and eventing

Every ClickHouse query starts `WHERE TenantId = {tenantId:String}` and filters the
partition key column when a date range exists; read
`dev/docs/best_practices/clickhouse-queries.md` first. On the API, eventing is producer
only: a service may send a command on a pipeline; process managers, appends and folds
run in the worker. A `subscribers/*.subscriber.ts` must be idempotent
(`eventing-subscriber-idempotency`).

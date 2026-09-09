# Convert a module to the annotation shape

`packages/features/annotation` is the shape. This reference is the same procedure for
every other module: measure the distance, then close each gap by copying the annotation
counterpart and moving the existing behaviour into it. Nothing is redesigned on the way:
every operation, error code, query and screen the module has today it still has after
(lift and shift). Read `.claude/skills/architecture-guide/SKILL.md`, then
`references/server.md` and `references/contract.md`; keep the annotation file open beside
the one you are writing.

## 0. Measure the distance

```bash
F=<module>; P=packages/features/$F
grep -n "\"$F\"" packages/architecture-lint/src/feature-shape-baseline.json
find $P/contract/src $P/server/src $P/web/src -type f | grep -v __tests__ | grep -v node_modules | sort
ls apps/api/src/features/$F apps/worker/src/features/$F 2>/dev/null
grep -rn "withFeature(" apps/api/src apps/worker/src apps/tasks/src | grep -v __tests__ | grep -i "$(echo $F | sed 's/-//g')"
```

Each baseline `kind` is one gap, and each gap has exactly one target in annotation:

| kind                        | what the module has                                     | copy this from annotation                                                                    |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `contract-service`          | `contract/src/<f>.service.ts` abstract class            | `contract/src/annotation.api.ts` (interface + `featureApi` token)                            |
| `persistence-adapter`       | `server/src/adapters/postgres.<x>.adapter.ts`           | `repositories/prisma/prisma.annotation-score.repository.ts` and its memory twin              |
| `unregistered-repositories` | repositories chosen by an adapter or the process        | `repositories/annotation-repositories.registry.ts`, `annotation.repositories.ts`             |
| `postgres-without-memory`   | Prisma repositories only                                | `repositories/memory/memory.annotation-score.repository.ts`, `memory.annotation.repositories.ts` |
| `no-app`                    | services constructed by transports or the process       | `app/annotation.app.ts`                                                                      |
| `no-installer`              | no `<f>.server.ts`                                      | `annotation.server.ts`                                                                       |
| `nested-transport`          | `transport/api-trpc/<f>.api.ts`, `transport/api-rest/…` | `transport/annotation.trpc.ts`, `annotation-score.trpc.ts`, `annotation.rest.ts`             |
| `legacy-transport-runtime`  | any file naming `createServiceApp`, `createServiceVersionedApp`, `createTrpcService`, `createProjectVersionedApp`, `mountProjectTransport` or their kin (all deleted) | the same declarations, mounted by the process on `createRestRuntime` / `createTrpcRuntime` (`apps/api/src/features/annotation/annotation-rest.mount.ts`, `annotation-trpc.mount.ts`) |
| `fixtures-directory`, `testing-entry` | `fixtures/`, `testing.ts` exported to other packages | `app/__tests__/annotation.fixture.ts`                                              |
| `installer-not-booted`      | `apps/api/src/features/<f>/<f>.composition.ts` hand-builds the app | `apps/api/src/features/annotation/annotation.composition.ts` (`installApiAnnotation`) |
| `refusing-composition`      | `refusing<F>Feature()` / `<f>-absence.ts`               | nothing: annotation's api composition installs the module or the root does not call it     |
| `nested-web-entry`          | `web/src/screens/<id>/index.ts`, `surfaces/<id>/…`      | `web/src/annotation-scores.ts` (flat entry) and `web/package.json` `exports`                 |

Work top to bottom: contract, repositories, services, app, installer, transports,
composition, web, tests. Each step leaves the package compiling and its tests green; a
step that has to break the next one is two steps.

## 1. Contract: the callable API

The abstract service's method list **is** the interface. Write `contract/src/<f>.api.ts`:

```ts
export interface ApiKeyApi {
  create(input: CreateApiKeyInput): Promise<ApiKey>;
  list(input: ListApiKeysInput): Promise<ApiKey[]>;
  …
}
export const ApiKeyApi = featureApi<ApiKeyApi>("api-key");
```

- Rename as you move, never after: `list`/`get` stay on the API (RPC verbs), `find*`
  returns `undefined` for absence, nothing is `try*`/`require*`, a `{ ok, error }` result
  becomes a thrown `HandledError` from `<f>.errors.ts`.
- A member that returns another service, a getter, a `tryGetX` lookup: it becomes a plain
  operation or it is dropped because no caller uses it (say which in the report). A
  `tryX` never survives the move: it becomes `getX` that throws the module's
  not-found error, and every caller that branched on `undefined` now catches or lets
  it propagate. `findX` returning `undefined` is only for an absence the caller
  treats as a normal answer.
- Inputs that are hand-written types become zod schemas in `<f>.schemas.ts` /
  `<f>-<part>.schemas.ts` (one file per sub-domain: annotation has `annotation-queue`,
  `annotation-review`, `annotation-response`), door-specific shapes in `<f>-trpc.schemas.ts`
  and `<f>-rest.schemas.ts`, types by `z.infer`.
- Delete `<f>.service.ts`. Update every importer to the new names; no re-export.

## 2. Repositories: interface, Prisma, memory, registry

For each `adapters/postgres.<x>.adapter.ts` (and each repository the adapter wires):

1. `repositories/<x>.repository.ts`: the interface. Its methods are the adapter's or the
   old repository's public methods, with their inputs typed from the contract. Repository
   verbs are `findAll`/`findById`/`create`/`update`/`delete`/`count…`.
2. `repositories/prisma/prisma.<x>.repository.ts`: `class Prisma<X>Repository extends
   PrismaRepository.for("<Model>") implements <X>Repository` with
   `static readonly create = this.factory((prisma) => new Prisma<X>Repository(prisma))`.
   Move the queries in unchanged, adding `projectId` to any where clause that lacks it.
   A `select` object is a module const. This is the only file that names Prisma.
3. `repositories/memory/memory.<x>.repository.ts`: the same observable behaviour over
   arrays or a `Map`; the same errors thrown for the same absences. Several twins that
   share rows share a `memory.<f>.database.ts`. A twin is only proven by a contract test
   (`repositories/__tests__/<x>.repository.contract.test.ts`) that runs the same cases
   against the memory and the Prisma backends; the installation test booting over the
   twin proves nothing about the twin. Five modules landed without one on 2026-09-08.
4. `repositories/<f>.repositories.ts` (the bundle interface),
   `repositories/prisma/prisma.<f>.repositories.ts` (`prismaRepositories({...})`),
   `repositories/memory/memory.<f>.repositories.ts` (`static readonly requires = [] as const`,
   `static create(): <F>Repositories`) and
   `repositories/<f>-repositories.registry.ts` (`defineRepositories({ postgres, memory })`).
5. Delete the adapter and the `ports/` file it implemented. A Redis, eventing or
   object-storage client is not persistence: the module names what it needs as a member of
   `<F>Infrastructure` (a plain `interface`, declared beside the app in `app/<f>.app.ts`,
   never an abstract class in a `ports/` folder) and the process that owns that client
   supplies an object satisfying it through `withInfrastructure`. A finished module has no
   `ports/` and no `adapters/` folder: `repositories/`, `services/`, `app/`, `transport/`.

Annotation's memory twins are the contract of "same behaviour": `MemoryAnnotationScoreRepository`
parses with the same contract schema the Prisma one returns rows through.

## 3. Services: one class per entity

`services/<x>.service.ts` is `class <X>Service` with a private constructor,
`static create({ repository })` (or the two repositories one aggregate needs; the queue
service takes `{ queues, items }`), and methods that parse the input with the contract
schema, call the repository and throw the entity's error. Anything a service does today
that is **not** that moves up into the app in step 4:

- calling a peer module (users, projects, organizations, authz, traces),
- calling another service of this module,
- reading a port,
- logging a decision or emitting an event.

Ten services that each wrap one method are not ten entities. Merge by aggregate:
annotation has four repositories and three services.

## 4. The app

`app/<f>.app.ts`, copied from `app/annotation.app.ts`:

```ts
export class ApiKeyApp implements ApiKeyApi {
  static readonly contract = ApiKeyApi;
  static readonly dependencies = { projects: ProjectApi, permissions: AuthzApi };
  #keys: ApiKeyService;
  #projects: ProjectApi;
  private constructor(repositories: ApiKeyRepositories, dependencies: ApiKeySetup["dependencies"]) { … }
  static create({ repositories, dependencies }: ApiKeySetup): ApiKeyApp { … }
  create(input: CreateApiKeyInput) { return this.#keys.create(input); }
}
```

- Every public member is an operation of `<F>Api`, nothing else (`feature-app-contract`).
- Peers are `*Api` tokens in `static dependencies`, never ports, never imported services,
  never optional. If a peer was optional before ("absent" adapter, `Logged*Absence`),
  it is required now and the process provides it; delete the absence adapter.
- Technical infrastructure (a token hasher, a key share, a clock, an audit sink, a
  viewer-protections lookup) is a member of `<F>Infrastructure`, the third `FeatureSetup`
  parameter: a plain interface beside the app, never a `ports/<x>.port.ts` file. The
  process supplies it in `withInfrastructure`; a test supplies a literal object.
- Orchestration that lived in a transport class or in the api composition (enrichment
  with users, authorization decisions, audit recording, cross-entity workflows) lands
  here, as private methods if it needs a name.

## 5. Installer and exports

`<f>.server.ts`: `defineFeature("<f>").withRepositories(<f>Repositories).withApp(<F>App).withTransports(…).build()`.
`index.ts` exports `<f>Server` and the transport declarations only. Delete `testing.ts`
and `fixtures/`; the builders become `app/__tests__/<f>.fixture.ts`
(`create<F>TestApp` over `Memory<F>Repositories`, peers via `createApiFixture<PeerApi>`).
Another package that imported the fixtures builds its own from the memory repositories.

## 6. Transports: flat declarations

For each class in `transport/api-trpc/<f>.api.ts`, one namespace becomes two files: the
declaration in the contract and the binding in the server.

```ts
// contract/src/api-key.trpc.ts
export const apiKeyTrpc = defineTrpcContract("apiKey")
  .query("list").withInput(listInputSchema).withOutput(apiKeySchema.array())
  .mutation("revoke").withInput(revokeInputSchema)
  .build();

// server/src/transport/api-key.trpc.ts
export const apiKeyTrpcTransport = defineTrpcRouter(ApiKeyApi, apiKeyTrpc)
  .procedure("list").withPermission("apiKeys:view").handle(({ app, input }) => app.list(input))
  .procedure("revoke").withPermission("apiKeys:manage").handle(async ({ app, input }) => { await app.revoke(input); })
  .build();
```

Each old procedure keeps the **same wire name**, the same input schema (moved into the
contract if it was private to the class) and the same output; the server keeps the
permission it enforced (or `noPermission({ reason })` / `serviceAuthorized({...})`) and a
handler calling one app operation. Logic found in the class body beyond input mapping
moves to the app first. The web package's hand-written map for these namespaces is then
replaced by `ContractApiMap<typeof apiKeyTrpc>`. REST becomes `transport/<f>.rest.ts` with
`defineRestRouter(<F>Api).withNamespace("<f>s").withVersion(MANAGEMENT_API_VERSION)…build()`,
same paths, same operation ids (`withDocs`), same schemas, mounted with `createRestRuntime`
(see `references/extend.md` section 6.3 for the current mount shape; the older
`security.createServiceVersionedApp` / `mountProjectTransport` builders are deleted; a
mount file that still names them is `legacy-transport-runtime`, not a pattern). Delete the
`api-trpc/` and `api-rest/` folders. `references/extend.md` sections 6 and 7 hold the
builder details and the browser side.

## 7. Composition: boot the installer

`apps/api/src/features/<f>/<f>.composition.ts` becomes `installApi<F>({ infrastructure, peers })`
copied from `annotation.composition.ts`: `createApp({ name: "langwatch-api" }).withPersistence("postgres", { prisma }).withInfrastructure({…}).withProvided(PeerApi, peer)….withFeature(<f>Server).boot({ role: "api" })`,
`runtime.feature(<f>Server).provided`, `routers(mount)` from `<f>-trpc.mount.ts`,
`restServices`. The root (`api-production.composition.ts`) calls it with the peers it
holds and no longer constructs the app. Delete `refusing<F>Feature`, `<f>-absence.ts`,
`Unavailable*` errors that exist only for the twin, and every call site: boot names a
missing provider by token. The worker root that owns the module's jobs adds
`.withFeature(<f>Server)` to its own `createApp` chain the same way. Details in
`references/wire.md`; the composition integration test drives the real mount with
`createApiFixture` peers.

## 8. Web: flat entries

Each `web/src/screens/<id>/index.ts` (or `surfaces/<id>/…`) becomes `web/src/<id>.ts` with
the same exports, listed in `package.json` `exports` as `"./<id>"` with
`langwatch-declaration-source`, `types`, `default`; `apps/ui/src/features/catalogue.json`
`uses.screens`/`uses.surfaces` is updated to `@langwatch/<f>-web/<id>`, and the
importing module folder under `apps/ui/src/features/` follows. Delete the folders. The
layers under `model/`, `behavior/`, `ui/` do not move.

## 9. Tests, then the ratchet

- `app/__tests__/<f>-installation.unit.test.ts` boots
  `createApp(...).withPersistence("memory", {}).withProvided(PeerApi, fixture).withFeature(<f>Server).boot({ role })`
  for every role the module serves.
- Service unit tests over the memory repositories; the Prisma repositories' integration
  test if the package declares a datastore; every existing test re-pointed at the new
  names (a `vi.mock` of a deleted path mocks nothing: grep for the old paths).
- Sabotage once per moved behaviour: break the memory twin, watch the service test fail
  for the right reason, restore.
- Gates per `.claude/skills/architecture-guide/references/gates.md`. Then the module's
  entries in `feature-shape-baseline.json` are stale and the root session deletes them;
  the lint reports the ones still standing. Done means
  `grep -c "\"<f>\"" packages/architecture-lint/src/feature-shape-baseline.json` is 0.

## Rules that hold throughout

- Move behaviour, do not improve it: same operations, same codes, same queries, same
  screens. A redesign is a separate change after the shape is right.
- No re-exports, no compatibility aliases, no `as unknown as`, no `as PrismaClient`, no
  `try*`, no optional collaborators, no `process.env` below the entrypoint.
- Comments under five lines; identifiers say what a thing is (`ApiKeyService`), not what
  it used to be (`LegacyApiKeyGrantService` is a smell to resolve, not to carry).
- A gap you cannot close in this change (a peer module with no `*Api` token yet, a job
  the worker registry freezes) is named in the report with the file that blocks it.
- **When auditing your own converted diff, compare old and new observable behaviour
  field by field**: response DTOs, auth, error/status mapping, sorting, pagination and
  cursors, money/time units, query tables, retries, idempotency and side effects. Passing
  package tests is not proof the conversion is complete; a field silently dropped or a
  status code that changed is a behaviour regression even when every test is green.
  Compare deleted tests against the canonical coverage too: list every scenario a
  deletion loses and restore meaningful coverage before removing the old test file.
- The spec wins. If the converted code answers differently from a bound scenario or a doc
  comment (a refusal that now succeeds, a status that changed), the code is wrong: fix the
  code, never the assertion. A lane once rewrote a test so a key bound to nobody could
  write a secret; the spec said otherwise.
- Read before you delete. `git diff` and read every file in a directory before `rm`; a
  lane deleted `adapters/` unread and lost another lane's uncommitted edits to two tests.
  Edit/Write for every change, no scripted rewrites (`sed`, heredocs) over files you have
  not read; a moved file goes with `mv`, not `git mv` (lanes never touch the index).
- A memory twin, a Prisma repository and a service are three files, not one 500-line
  class: an app past ~30 public operations is several modules wearing one door; say so
  in the report rather than folding a fifth namespace in.

## Report

For each kind the module carried: closed or still open, and the file that proves it.
The operations on `<F>Api`; the repositories and their two backends; the peers in
`static dependencies` and who provides them; the transports and their namespaces;
what was deleted; gate numbers; what is left and why.

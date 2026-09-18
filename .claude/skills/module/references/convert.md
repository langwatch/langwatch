# Convert a module to the target shape

`modules/annotation` is the shape. This reference is the same procedure for
every other module: measure the distance, then close each gap by copying the
annotation counterpart and moving the existing behaviour into it. Nothing is
redesigned on the way: every operation, error code, query and screen the
module has today it still has after (lift and shift). Read
`dev/docs/ARCHITECTURE.md` §3 and §16, then keep the annotation file open
beside the one you are writing. §16 is your translation table throughout: the
`kind` names below are the enforcer's own vocabulary and do not change, but
every path and identifier you write in their place is the **target** column,
never the "Today" one.

## 0. Measure the distance

```bash
F=<module>; P=modules/$F
grep -n "\"$F\"" packages/architecture-enforcer/src/feature-shape-baseline.json
find $P/contract/src $P/server/src $P/web/src -type f 2>/dev/null | grep -v __tests__ | grep -v node_modules | sort
grep -rn "withModule(" apps/api/src apps/worker/src apps/tasks/src | grep -v __tests__ | grep -i "$(echo $F | sed 's/-//g')"
```

(The module still sits under `server/`/`web/` on disk until this conversion
renames the packages — see step 5's rename note.)

Each baseline `kind` is one gap, and each gap has exactly one target in
annotation:

| kind                        | what the module has                                     | copy this from annotation                                                                    |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `contract-service`          | `contract/src/<f>.service.ts` abstract class            | `contract/src/annotation.api.ts` (interface + `moduleApi` token)                            |
| `persistence-adapter`       | `process/src/adapters/postgres.<x>.adapter.ts`          | `repositories/prisma/prisma.annotation-score.repository.ts` and its memory twin              |
| `unregistered-repositories` | repositories chosen by an adapter or the process root   | `repositories/annotation-repositories.registry.ts`, `annotation.repositories.ts`             |
| `postgres-without-memory`   | Prisma repositories only                                | `repositories/memory/memory.annotation-score.repository.ts`, `memory.annotation.repositories.ts` |
| `no-app`                    | services constructed by transports or the process       | `<Name>Module` in `<name>.module.ts` |
| `no-installer`              | no `<f>.module.ts`                                       | `annotation.module.ts` (installer + `AnnotationModule`, one file)                            |
| `nested-transport`          | `transport/api-trpc/<f>.api.ts`, `transport/api-rest/…` | `transport/annotation.trpc.ts`, `annotation-score.trpc.ts`, `annotation.rest.ts`             |
| `legacy-transport-runtime`  | any file naming `createServiceApp`, `createServiceVersionedApp`, `createTrpcService`, `createProjectVersionedApp`, `mountProjectTransport`, `createRestRuntime`/`createTrpcRuntime` mount files, or their kin (all deleted, record §15) | nothing to build — the installer's `.withTransports(...)`, opened by `boot()` (`references/transport.md`) |
| `fixtures-directory`, `testing-entry` | `fixtures/`, `testing.ts` exported to other packages | `__tests__/annotation.fixture.ts`                                              |
| `installer-not-booted`      | no entry in `modules/catalogue.json`, or installed by hand somewhere | `modules/catalogue.json` entry + `pnpm generate:modules` (`references/wire.md`) |
| `refusing-composition`      | `refusing<F>Feature()` / `<f>-absence.ts`               | nothing: the installed module supplies the capability or the process does not install it (record §15) |
| `nested-web-entry`          | `web/src/screens/<id>/index.ts`, `surfaces/<id>/…`      | `browser/src/annotation-scores.ts` (flat entry) and `browser/package.json` `exports`          |

Work top to bottom: contract, repositories, services, `<Name>Module`,
installer, transports, browser, tests. Each step leaves the package compiling
and its tests green; a step that has to break the next one is two steps.

## 1. Contract: the callable API

The abstract service's method list **is** the interface. Write
`contract/src/<f>.api.ts`:

```ts
export interface ApiKeyApi {
  create(input: CreateApiKeyInput): Promise<ApiKey>;
  list(input: ListApiKeysInput): Promise<ApiKey[]>;
  …
}
export const ApiKeyApi = moduleApi<ApiKeyApi>("api-key");
```

- Rename as you move, never after: `list`/`get` stay on the API (RPC verbs),
  `find*` returns `undefined` for absence, nothing is `try*`/`require*`, a
  `{ ok, error }` result becomes a thrown `HandledError` from `<f>.errors.ts`.
- A member that returns another service, a getter, a `tryGetX` lookup: it
  becomes a plain operation or it is dropped because no caller uses it (say
  which in the report). A `tryX` never survives the move: it becomes `getX`
  that throws the module's not-found error, and every caller that branched on
  `undefined` now catches or lets it propagate. `findX` returning `undefined`
  is only for an absence the caller treats as a normal answer.
- Inputs that are hand-written types become zod schemas in `<f>.schemas.ts` /
  `<f>-<part>.schemas.ts` (one file per sub-domain: annotation has
  `annotation-queue`, `annotation-review`, `annotation-response`),
  door-specific shapes in `<f>-trpc.schemas.ts` and `<f>-rest.schemas.ts`,
  types by `z.infer`. A deployment fact the module reads today from
  `process.env` becomes a field on `<f>.config.ts` (record §6).
- Delete `<f>.service.ts`. Update every importer to the new names; no
  re-export.

## 2. Repositories: interface, Prisma, memory, registry

For each `adapters/postgres.<x>.adapter.ts` (and each repository the adapter
wires):

1. `repositories/<x>.repository.ts`: the interface. Its methods are the
   adapter's or the old repository's public methods, with their inputs typed
   from the contract. Repository verbs are
   `findAll`/`findById`/`create`/`update`/`delete`/`count…`.
2. `repositories/prisma/prisma.<x>.repository.ts`: `class Prisma<X>Repository
   extends PrismaRepository.for("<Model>") implements <X>Repository` with
   `static readonly create = this.factory((prisma) => new Prisma<X>Repository(prisma))`.
   Move the queries in unchanged, adding `projectId` to any where clause that
   lacks it. A `select` object is a module const. This is the only file that
   names Prisma.
3. `repositories/memory/memory.<x>.repository.ts`: the same observable
   behaviour over arrays or a `Map`; the same errors thrown for the same
   absences. Several twins that share rows share a `memory.<f>.database.ts`.
   A twin is only proven by a contract test
   (`repositories/__tests__/<x>.repository.contract.test.ts`) that runs the
   same cases against the memory and the Prisma backends; the installation
   test booting over the twin proves nothing about the twin.
4. `repositories/<f>.repositories.ts` (the bundle interface),
   `repositories/prisma/prisma.<f>.repositories.ts` (`prismaRepositories({...})`),
   `repositories/memory/memory.<f>.repositories.ts`
   (`static readonly requires = [] as const`, `static create(): <F>Repositories`)
   and `repositories/<f>-repositories.registry.ts`
   (`defineRepositories({ live, memory })`).
5. Delete the adapter and the `ports/` file it implemented. A Redis, eventing
   or object-storage client is not persistence: it is either a channel (step
   2b), or, when the module wants the raw client itself, a member the
   registry or channel factory's `create(members)` receives directly
   (`live.create({ prisma, clickhouse, encryption })`, record §5) — never an
   abstract class in a `ports/` folder, never held by `<Name>Module`. A
   finished module has no `ports/` and no `adapters/` folder: `repositories/`,
   `services/`, `channels/`, `transport/`, `rules/`, plus the one
   `<name>.module.ts`.

Annotation's memory twins are the contract of "same behaviour":
`MemoryAnnotationScoreRepository` parses with the same contract schema the
Prisma one returns rows through.

## 2b. Channels: the messages the module does not own

A repository is state the module owns. A **channel** is messages to or from
something it does not own, in either direction, with no owned state: the
event bus, Redis pub/sub, HTTP to a vendor, a queue, email, Slack, a browser
over SSE. `go run ./tools/shapemod channels modules/<f>` lists every file
under `services/` and `adapters/` whose imports or calls give one away, with
the signal that fired.

The shape mirrors step 2 exactly:

1. `channels/<x>.channel.ts`: the interface, in the module's own message
   types (`publishRunFinished(run)`, not `publish(topic, buffer)`).
2. `channels/<tier>/<tier>.<x>.channel.ts`: one implementation per tier, the
   folder and the filename's first qualifier the same word. `<tier>` is
   `eventing`, `redis`, `http`, `sqs`, `ses` or `slack`.
3. `channels/memory/memory.<x>.channel.ts`: the twin every test asserts
   against — it records what was sent and replays what is received.
4. `channels/<f>-channels.registry.ts`: exports `{ live, memory }`, each a
   class with `static readonly requires` and `static create`.

The service then takes the channel interface and imports no bus, no pub/sub
and no HTTP client (`service-does-not-open-a-channel`). A live channel with
no twin, or one missing from the registry, is
`feature-shape: unregistered-channels`.

## 3. Services: one class per entity

`services/<x>.service.ts` is `class <X>Service` with a private constructor,
`static create({ repository })` (or the two repositories one aggregate needs;
the queue service takes `{ queues, items }`), and methods that parse the
input with the contract schema, call the repository and throw the entity's
error. Anything a service does today that is **not** that moves up into
`<Name>Module` in step 4:

- calling a peer module (users, projects, organizations, authz, traces),
- calling another service of this module,
- reading a config value or a supply token,
- opening a conduit the module does not own (that becomes a channel, step 2b),
- logging a decision or emitting an event.

Ten services that each wrap one method are not ten entities. Merge by
aggregate: annotation has four repositories and three services.

## 4. `<Name>Module`

`<f>.module.ts`, copied from `annotation.module.ts`:

```ts
export class ApiKeyModule implements ApiKeyApi {
  static readonly contract = ApiKeyApi;
  static readonly dependencies = { projects: ProjectApi, permissions: AuthzApi };
  #keys: ApiKeyService;
  #projects: ProjectApi;
  private constructor(repositories: ApiKeyRepositories, dependencies: ApiKeySetup["dependencies"]) { … }
  static create({ repositories, dependencies }: ApiKeySetup): ApiKeyModule { … }
  create(input: CreateApiKeyInput) { return this.#keys.create(input); }
}

export const apiKeyProcessModule = defineProcessModule("api-key")
  .withRepositories(apiKeyRepositories)
  .withApi(ApiKeyModule)
  .withTransports(apiKeyRest, apiKeyTrpc);
```

- Every public member is an operation of `<F>Api`, nothing else
  (`feature-app-contract`).
- Peers are `*Api` tokens in `static dependencies`, never ports, never
  imported services, never optional. If a peer was optional before (an
  "absent" adapter, `Logged*Absence`), it is required now and the process
  provides it; delete the absence adapter (record §3.3 case 2, §15).
- A deployment fact (a signing key, a base URL) comes through `setup.config`,
  sliced from the module's own config schema (record §6, §3.3 case 3) —
  never a `<F>Infrastructure` bag, never `process.env`.
- An availability decision (a capability this deployment may not have) is a
  declared supply token in `setup.supplies`, answered by the process's
  `.provide({...})` (record §3.3 case 4).
- Orchestration that lived in a transport class or in per-app composition
  (enrichment with users, authorization decisions, audit recording,
  cross-entity workflows) lands here, as private methods if it needs a name.

## 5. Installer, package rename and exports

The installer and the class live in one file, `<f>.module.ts`:
`defineProcessModule("<f>").withRepositories(<f>Repositories).withApi(<F>Module).withTransports(…)`.
`index.ts` exports `<f>ProcessModule` and the transport declarations only.
Delete `testing.ts` and `fixtures/`; the builders become
`__tests__/<f>.fixture.ts` (`create<F>TestModule` over `Memory<F>Repositories`,
peers via `createApiFixture<PeerApi>`). Another package that imported the
fixtures builds its own from the memory repositories.

If the module's packages are still named `server`/`web` (record §16), rename
the directories and `package.json` names to `process`/`browser` in this same
step — `@langwatch/<f>-server` → `@langwatch/<f>-process`,
`@langwatch/<f>-web` → `@langwatch/<f>-browser` — and update every importer.
Do this once per module, not file by file: a half-renamed package compiles
against neither name.

## 6. Transports: flat declarations

For each class in `transport/api-trpc/<f>.api.ts`, one namespace becomes two
files: the declaration in the contract and the binding in the process.

```ts
// contract/src/api-key.trpc.ts
export const apiKeyTrpc = defineTrpcContract("apiKey")
  .query("list").withInput(listInputSchema).withOutput(apiKeySchema.array())
  .mutation("revoke").withInput(revokeInputSchema)
  .build();

// process/src/transport/api-key.trpc.ts
export const apiKeyTrpcTransport = defineTrpcRouter(ApiKeyApi, apiKeyTrpc)
  .procedure("list").withPermission("apiKeys:view").handle(({ app, input }) => app.list(input))
  .procedure("revoke").withPermission("apiKeys:manage").handle(async ({ app, input }) => { await app.revoke(input); })
  .build();
```

Each old procedure keeps the **same wire name**, the same input schema
(moved into the contract if it was private to the class) and the same
output; the process keeps the permission it enforced (or
`noPermission({ reason })` / `serviceAuthorized({...})`) and a handler
calling one `<Name>Module` operation. Logic found in the class body beyond
input mapping moves to `<Name>Module` first. The browser package's
hand-written map for these namespaces is then replaced by
`ContractApiMap<typeof apiKeyTrpc>`. REST becomes `transport/<f>.rest.ts`
with `defineRestRouter(<F>Api).withNamespace("<f>s")…build()`, same paths,
same operation ids (`withDocs`), same schemas. Delete the `api-trpc/` and
`api-rest/` folders. `references/transport.md` sections 1 and 2 hold the
builder details and the browser side.

## 7. Wiring: the catalogue, not a composition file

There is no per-module composition file any more (record §15): the module's
catalogue entry plus `pnpm generate:modules` is the whole wiring (see
`wire.md`), and the process root does not change. Delete `refusing<F>Feature`,
`<f>-absence.ts`, `Unavailable*` errors that exist only for the twin, and
every call site: `boot()` names a missing provider by token. The worker
process installs the same `<f>ProcessModule` in its own `withModules(...)`
list. Details in `references/wire.md`.

## 8. Browser: flat entries

Each `web/src/screens/<id>/index.ts` (or `surfaces/<id>/…`) becomes
`browser/src/<id>.ts` with the same exports, listed in `package.json`
`exports` as `"./<id>"`. Cross-module sharing moves through a
`browser-kit` package instead of the old catalogue "uses" declarations —
see `references/web-surface.md` for what moves versus what is deleted. The
layers under `model/`, `behavior/`, `ui/` do not move.

## 9. Tests, then the ratchet

- `__tests__/<f>-installation.unit.test.ts` boots the installer through the
  ruled chain with memory storage, for every role the module serves (record
  §15's deleted spellings must not be copied).
- Service unit tests over the memory repositories; the Prisma repositories'
  integration test if the package declares a datastore; every existing test
  re-pointed at the new names (a `vi.mock` of a deleted path mocks nothing:
  grep for the old paths).
- Sabotage once per moved behaviour: break the memory twin, watch the service
  test fail for the right reason, restore.
- Then the module's entries in `feature-shape-baseline.json` are stale and
  the root session deletes them; the lint reports the ones still standing.
  Done means `grep -c "\"<f>\"" packages/architecture-enforcer/src/feature-shape-baseline.json`
  is 0.

## Rules that hold throughout

- Move behaviour, do not improve it: same operations, same codes, same
  queries, same screens. A redesign is a separate change after the shape is
  right.
- No re-exports, no compatibility aliases, no `as unknown as`, no
  `as PrismaClient`, no `try*`, no optional collaborators, no `process.env`
  below the entrypoint.
- Comments under five lines; identifiers say what a thing is
  (`ApiKeyService`), not what it used to be (`LegacyApiKeyGrantService` is a
  smell to resolve, not to carry).
- A gap you cannot close in this change (a peer module with no `*Api` token
  yet, a job the worker registry freezes) is named in the report with the
  file that blocks it.
- **When auditing your own converted diff, compare old and new observable
  behaviour field by field**: response DTOs, auth, error/status mapping,
  sorting, pagination and cursors, money/time units, query tables, retries,
  idempotency and side effects. Passing package tests is not proof the
  conversion is complete; a field silently dropped or a status code that
  changed is a behaviour regression even when every test is green. Compare
  deleted tests against the canonical coverage too: list every scenario a
  deletion loses and restore meaningful coverage before removing the old
  test file.
- The spec wins. If the converted code answers differently from a bound
  scenario or a doc comment (a refusal that now succeeds, a status that
  changed), the code is wrong: fix the code, never the assertion.
- Read before you delete. `git diff` and read every file in a directory
  before `rm`. Edit/Write for every change, no scripted rewrites (`sed`,
  heredocs) over files you have not read; a moved file goes with `mv`, not
  `git mv` (lanes never touch the index).
- A memory twin, a Prisma repository and a service are three files, not one
  500-line class: a module past ~30 public operations is several modules
  wearing one door; say so in the report rather than folding a fifth
  namespace in.

## Report

For each kind the module carried: closed or still open, and the file that
proves it. The operations on `<F>Api`; the repositories and their two
backends; the peers in `static dependencies` and who provides them; the
transports and their namespaces; what was deleted; gate results; what is
left and why.

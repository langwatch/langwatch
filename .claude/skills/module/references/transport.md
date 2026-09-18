# Add a REST endpoint or a tRPC procedure

Read `dev/docs/ARCHITECTURE.md` §8 first. The two transport declarations a
module gains most often, each in full: a REST endpoint on the flat
`transport/<f>.rest.ts` declaration (section 1) and a tRPC procedure on the
flat `transport/<f>.trpc.ts` binding (section 2). Both are the transport step
of the walk in `references/extend.md`, which covers the rest of extending a
module (spec, contract, process, browser, gates, report): work its sections 0
to 5 first, because a handler calls exactly one `<Name>Module` operation and
that operation has to exist before the declaration does.

**The process mounts declarations; a module never mounts anything (record
§8).** There is no per-module mount file, no per-module composition file, no
hand-assembled router: `.withTransports(fooRest, fooTrpc)` on the module's
installer is the whole act of publishing a transport. `boot()` (record §5)
opens the REST family, the tRPC namespace and the SSE lane on the server for
every installed module's role; authentication is configured **once**, at the
app level, via `createApp(...).withTransportAuth((a) => a.withStaticTokens({...}).withBrowserSession(session))`
(record §4) — a module's transport declaration names a permission, never a
credential source.

## 1. Adding a REST endpoint

Declare its params, query, body and response schemas in the module's
contract, add the operation to the `<Feature>Api`, write the inline handler
on the module's flat `transport/<f>.rest.ts` declaration (`defineRestRouter`
from `@langwatch/api`) with its permission and docs, list it in the
installer's `.withTransports(...)`, regenerate the OpenAPI description with
the task instead of hand-editing the frozen document, and bind the scenario.
The reference implementation is `annotation`, end to end:

```
modules/annotation/contract/src/annotation-rest.schemas.ts     params, query, body and response schemas
modules/annotation/contract/src/annotation.api.ts              the operation the handler calls
modules/annotation/process/src/transport/annotation.rest.ts    the declaration with inline handlers
modules/annotation/process/src/annotation.module.ts            .withTransports(annotationRest, …) on the installer
```

A `transport/api-rest/**` or `transport/public-rest/**` folder is the older
spelling; a module that still has one is listed in
`packages/architecture-enforcer/src/feature-shape-baseline.json`
(`nested-transport`). New endpoints go on the flat declaration even in such a
module; if the module has no flat declaration yet, create
`transport/<f>.rest.ts` and list it on the installer rather than adding to
the folder.

### 1.1. Declare the shapes in the contract

In `<f>-rest.schemas.ts`: a params schema whose keys are exactly the `:name`
segments of the path, a query schema, a body schema, and the response
schemas. Keys must not collide across params, query and body (the framework
merges them into one `input`).

```ts
export const annotationRestParamsSchema = z.object({ id: z.string().min(1) });
export const annotationRestQuerySchema = z.object({ anchor: annotationAnchorScopeSchema.default("all") });
export const annotationRestWriteSchema = z.object({ comment: z.string().min(1), isThumbsUp: z.boolean() });
export const annotationRestResponseSchema = z.object({ data: z.looseObject(annotationSchema.shape) });
```

The operation the handler will call is a method on `interface <F>Api` in
`<f>.api.ts`; add it there if it is new (`extend.md` section 2), and
`<Name>Module` implements it.

### 1.2. Write the handler on the declaration

`modules/<f>/process/src/transport/<f>.rest.ts`:

```ts
export const annotationRest = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)

  .post("/trace/:id", "createTraceAnnotation")
  .withParams(annotationRestParamsSchema)
  .withInput(annotationRestWriteSchema)
  .withPermission("annotations:create")
  .withOutput(annotationRestResponseSchema)
  .withDocs({ summary: "Create an unattributed annotation on a trace" })
  .handle(async ({ app, input, scope }) => {
    const annotation = await app.createUnattributed({ ...input, projectId: scope.id, traceId: input.id });
    return { data: annotation };
  })

  .delete("/:id", "deleteAnnotation")
  .withParams(annotationRestParamsSchema)
  .withPermission("annotations:manage")
  .withDocs({ summary: "Delete an annotation in the caller’s project" })
  .handle(async ({ app, input, scope }) => {
    await app.delete({ id: input.id, projectId: scope.id });
  })

  .build();
```

`withNamespace` is the family name and the base path (`/api/annotations`);
`boot()` reads it from the declaration instead of a process restating it. A
route without `withOutput` answers 204; a params schema whose keys differ
from the path's `:params` does not compile; a route without `withPermission`
has no `handle` to call.

- `.get/.post/.patch/.put/.delete(path, operationId)`: the path is relative
  to the family's base path, the operation id is unique across every
  installed module.
- `.withParams` / `.withQuery` / `.withInput` declare the sources; `input` is
  their merge, already parsed. `.withOutput` is mandatory for any route that
  returns a value; a no-content route declares none and returns `void`.
- `.withPermission(permission)` names the `AuthzPermission` the framework
  checks against the authorized `scope` (`{ tier: "project", id }`) before
  the handler runs; a route without one must say why with the declared
  alternative kinds (`withoutPermission`).
- The handler reads `{ app, input, actor, scope, signal }`, calls exactly one
  `<Name>Module` operation and returns a value. It never touches a
  repository, constructs a service, reads a header or `process.env`, or
  builds a `Response`; throw the contract's `HandledError` and the framework
  serialises it — no `RestErrorHandler`, no error envelope (record §8, §15).
- `.withVersion` is the date-based version of the whole declaration; bump it
  only when the wire shape changes for existing callers.
- Export the declaration from the process package `index.ts` and list it in
  `<f>.module.ts`'s `.withTransports(...)`.

### 1.3. Wiring: nothing to write

Adding the declaration to `.withTransports(...)` is the whole act. There is
no `<f>-rest.mount.ts`, no `createRestRuntime`, no per-app credential
plumbing to write — those are deleted spellings (record §15, "per-module
composition files under `apps/*`"). `boot()` registers the family on the
server for role `api` and refuses at compile time if the process never
supplied a requirement the module declared (record §5). If you find such a
mount file still standing beside the module you are extending, it is
conversion debt for `references/convert.md`, not a pattern to extend.

### 1.4. OpenAPI

```bash
pnpm --filter @langwatch/platform-api task openapi-generate /tmp/openapi.json
pnpm --filter @langwatch/platform-api task openapi-check /tmp/openapi.json
```

`openapi-generate` describes the routes the installed modules serve and
never writes the frozen description file directly: that artefact is frozen,
routes serve it and both SDKs generate clients from it, so replacing it is a
decision a person makes with the diff in front of them. Never hand-edit it.
`openapi-check` fails only in the breaking direction: the frozen document
lists an operation no route serves.

### 1.5. REST tests

- `modules/<f>/process/src/transport/__tests__/<f>.rest.integration.test.ts`:
  mount the declaration through the harness host over `create<F>TestModule()`
  and assert the golden path, the refusal for each declared error, and a call
  without the permission.
- The installation test (record §13) drives the module through
  `createApp({ role: "api" }).withModules([...]).withStores(memoryStores()).boot()`
  with `createApiFixture` peers.
- Assert on error `code` and status, never on message prose.

## 2. Adding a tRPC procedure

The contract input schema and `<Feature>Api` operation, the procedure
declared once in the contract's `<f>.trpc.ts` (`defineTrpcContract`: name,
kind, input, output), its permission and handler bound in the process's flat
`transport/<f>.trpc.ts` (`defineTrpcRouter`), listed on the installer's
`.withTransports(...)`, and the browser client derived from the contract
(`ContractApiMap`, never `AppRouter`, ADR-130) plus its hook. The reference is
`annotation`:

```
modules/annotation/contract/src/annotation-trpc.schemas.ts        input schemas
modules/annotation/contract/src/annotation.trpc.ts                the `annotation.*` declaration (defineTrpcContract)
modules/annotation/contract/src/annotation-score.trpc.ts          the `annotationScore.*` declaration
modules/annotation/contract/src/annotation.api.ts                 the operations the handlers call
modules/annotation/process/src/transport/annotation.trpc.ts       the `annotation.*` binding (defineTrpcRouter)
modules/annotation/process/src/transport/annotation-score.trpc.ts the `annotationScore.*` binding
modules/annotation/browser/src/behavior/annotation-api.ts         the browser client, derived from the contract
```

tRPC is the first-party browser transport only. Public integrations get REST
(ADR-128, section 1 above). A `transport/api-trpc/<f>.api.ts` folder is the
older spelling (`feature-shape: nested-transport`); add new procedures to the
contract declaration and its flat binding, creating `contract/src/<f>.trpc.ts`
and `process/src/transport/<f>.trpc.ts` if the module has none yet.

A procedure is stated once. The contract names it, its kind, its input and
its output; the process binds a permission and a handler to that name and
repeats nothing; the browser derives its client from the contract's type.
Design: `packages/api/adrs/20260908-transport-declaration-split.md`; spec:
`packages/api/specs/transport-declaration-split.feature`.

### 2.1. Spec first

Golden path plus each named refusal, tagged and bound per the `spec-bind`
skill.

### 2.2. Contract: declare the procedure

The input schema goes in `<f>-trpc.schemas.ts` (`<f>ApiCreateInputSchema`,
with the `projectId` the permission is checked against as a required field).
The output is a contract schema (`annotationSchema`,
`annotationScoreSchema.array()`). The operation is a method on
`interface <F>Api` in `<f>.api.ts`; a new failure gets a `HandledError`
subclass in `<f>.errors.ts`, its code added to
`packages/handled-error/src/app-codes.ts` and its copy to
`packages/handled-error/src/presentation.ts` in the same change.

Then the procedure itself joins the namespace's declaration in
`modules/<f>/contract/src/<f>.trpc.ts` (one file per namespace):

```ts
export const annotationScoreTrpc = defineTrpcContract("annotationScore")
  .query("getAllActive")
  .withInput(annotationScoreProjectScopeSchema)
  .withOutput(annotationScoreSchema.array())
  .mutation("upsert")
  .withInput(annotationScoreUpsertInputSchema)
  .withOutput(annotationScoreSchema)
  .build();
```

- `.query(name)` / `.mutation(name)` / `.subscription(name)`, then
  `.withInput(schema)`; `.withOutput(schema)` states the answer, and omitting
  it declares a procedure that answers nothing (a handler returning data then
  does not compile).
- The file value-imports `@langwatch/api`, `zod` and sibling schemas only. It
  is what the browser reads, so nothing process-side may reach it.
- Declaring the same name twice throws at module load; the wire name is the
  React Query cache key, so it is chosen once here and never spelled again.

### 2.3. Process: bind permission and handler

`modules/<f>/process/src/transport/<f>.trpc.ts`. One file per namespace; it
constructs nothing and repeats nothing the contract said:

```ts
export const annotationScoreTrpcTransport = defineTrpcRouter(AnnotationApi, annotationScoreTrpc)
  .procedure("getAllActive")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) => app.listScores({ projectId: input.projectId, activeOnly: true }))
  .procedure("upsert")
  .withPermission("annotations:manage")
  .handle(async ({ app, input }) => app.upsertScore(toUpsertInput(input)))
  .build();
```

- `.procedure(name)` selects a member the contract declared; a name it did
  not declare, the same name twice, or `build()` with a member unimplemented
  does not compile (and `router(app)` throws by name at runtime as the
  second line).
- `.withPermission(...)` takes an `AuthzPermission` or an `AuthzDeclaration`,
  and the check reads its scope id from the **validated** input. A procedure
  that cannot take a permission states why with `noPermission({ reason })` or
  `serviceAuthorized({ reason, permissions, enforces })`. Without an access
  decision there is no `handle` to call.
- The handler reads `{ app, input, actor, scope, signal }`, typed from the
  contract's input, and calls exactly one `<Name>Module` operation. Its
  return must satisfy the declared output. Small wire-to-domain mapping
  (`radioOptions(...)`) is a module-local function beside the binding; domain
  logic is not. No repositories, no services constructed, no `ctx`, no
  `process.env`, no `TContext`/`TRoot`/mount type.
- Export the binding from the process package `index.ts` and list it in
  `<f>.module.ts`'s `.withTransports(...)`. Two namespaces from one module
  are two contract declarations and two bindings (`annotationTrpcTransport`,
  `annotationScoreTrpcTransport`).

### 2.4. Wiring: nothing to write

As with REST (section 1.3), listing the binding on `.withTransports(...)` is
the whole act — no `<f>-trpc.mount.ts`, no `app-trpc.features.ts` entry, no
`ComposedApiFeatures` slot, no `createTrpcHandlerBinding`/`createTrpcService`
chain to hand-assemble. `boot()` mounts every installed module's namespaces
under role `api` (record §4, §5, §8). A file still building one of those by
hand is conversion debt (`references/convert.md`'s job), not a pattern to
copy.

Test it: the installation test (record §13) drives the real module with
`createApiFixture` peers and a recording Prisma client.

### 2.5. The browser side

`modules/<f>/browser/src/behavior/<f>-api.ts` derives the client from the
contract; a new procedure on a declared namespace needs no edit here:

```ts
type AnnotationProcedures = ContractApiMap<typeof annotationTrpc> & ContractApiMap<typeof annotationScoreTrpc>;
export const annotationApi = createModuleApi<AnnotationProcedures>();
export type RouterOutputs = OutputsFromMap<AnnotationProcedures>;
```

- **Never name `AppRouter`** (ADR-130) and never write a procedure map by
  hand for a namespace this module declares. A procedure another module owns
  and this package still calls is the one hand-written exception, in a
  `BorrowedProcedures` type that says so until that module's contract
  declares it; `WireOf<T>` gives its serialised shape.
- **The segment names are load-bearing.** The contract's namespace
  (`"annotationScore"`) is what tRPC hashes into the React Query cache key —
  a different spelling silently stops sharing a cache with every other call
  site.
- The hook goes in `behavior/use-<thing>.ts` and returns state and callbacks,
  never JSX. Mutation failures are read with `readHandledError` and rendered
  from the code-keyed registry; `meta.fieldErrors` maps onto the offending
  form fields.
- Component tests are `.integration.test.tsx` with the jsdom docblock,
  rendered inside the package's `Stub<F>Host`.

## Gates

`references/extend.md`'s gates, including the transport lines it adds for a
transport change. `feature-shape` must not gain an entry for the module.

## Report

`references/extend.md`'s report shape: the transport part is the operations
with method/path/version and permission, or the namespace and procedure
names, and whether a namespace was added.

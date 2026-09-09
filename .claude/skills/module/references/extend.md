# Extend a module

Read `.claude/skills/architecture-guide/SKILL.md` and the reference for each layer you
touch. The point of this reference is that one capability touches several packages in a
fixed order, and skipping a layer is what produces a 500 dressed as "unknown error" or a
screen that calls a procedure nobody mounted. Adding a REST route or a tRPC procedure is
part of this same walk: sections 6 and 7 below are the transport steps in full; do not
treat them as a separate task.

## 0. Locate the owner and its shape

```bash
grep -n '"<subject>"' modules/catalogue.json        # who owns it
find modules/<f> -maxdepth 4 -type d | grep -v node_modules
grep -n '"<f>"' packages/architecture-lint/src/feature-shape-baseline.json   # what it still carries from the older shape
```

Read the contract's `<f>.api.ts`, the app, the repository interfaces, the transport
declarations and the web api-map. A module with no baseline entries is in the annotation
shape: follow it exactly. A module with entries is mid-conversion: **add the capability
in the annotation shape** (an operation on the app, a method on the repository interface
and both backends, an inline handler on the flat declaration) and do not add to the legacy
pieces (no new method on an abstract contract service, no new route in
`transport/api-trpc/`, no new adapter). If the legacy piece is the only place the module
has, say so in the report; converting the module is `references/convert.md`'s job.

## 1. Spec

Add scenarios to `modules/<f>/specs/*.feature` (or `specs/<area>/*.feature`
if the behaviour is cross-cutting): the golden path and each named failure with its
error code, tagged `@unit`/`@integration`. Follow the `spec-bind` skill; every scenario
you add will be bound by a test in this change.

## 2. Contract

- Inputs and outputs: zod schemas in `<f>.schemas.ts` (or the `<f>-<part>.schemas.ts`
  that owns the shape), types via `z.infer`. Door-specific input shapes go in
  `<f>-trpc.schemas.ts` / `<f>-rest.schemas.ts`.
- The operation joins `interface <F>Api` in `<f>.api.ts` with an RPC verb (`get`,
  `getMany`, `list`, `create`, `update`, `delete`, `<verb><Entity>`).
- New failure: a `HandledError` subclass in `<f>.errors.ts` with a stable `code`, explicit
  `fault` and `httpStatus`; add the code to `packages/handled-error/src/app-codes.ts`
  (sorted) and its customer copy to `packages/handled-error/src/presentation.ts`.
- Do not make an existing schema `.strict()` unless you own every producer.

## 3. Server

- **Repository**: add the method to the interface in `repositories/<name>.repository.ts`,
  to `repositories/prisma/prisma.<name>.repository.ts` (`projectId` in every where
  clause) **and** to `repositories/memory/memory.<name>.repository.ts` with the same
  observable behaviour. New columns: edit `packages/prisma-client/prisma/schema.prisma`,
  add a migration, run `pnpm start:prepare:files`.
- **Service**: implement the method in `services/<name>.service.ts`: parse the input with
  the contract schema, call the repository, throw the entity's error. Pure helpers go in
  `rules/<name>.rules.ts`, never a `utils/` folder.
- **App**: the operation goes on `app/<f>.app.ts` so every transport shares one path.
  Peer calls (`this.#projects.getOrganizationId(...)`), authorization decisions through
  `AuthzApi`, cross-entity workflows and side effects live here. A new peer is a token
  added to `static dependencies`, provided by the composition (section 8).
- **Transport**: a browser-facing procedure follows section 7 below (an inline handler on
  `transport/<f>.trpc.ts`); a public HTTP endpoint follows section 6 below (an inline
  handler on `transport/<f>.rest.ts`).
- **Tests**: `services/__tests__/<name>.service.unit.test.ts` and
  `app/__tests__/*.unit.test.ts` over `create<F>TestApp` bind the `@unit` scenarios; a
  transport or Prisma repository integration test binds the `@integration` ones. Extend
  `app/__tests__/<f>.fixture.ts` when a peer method is new: `createApiFixture` throws on
  any method the fixture does not configure.

## 4. Web

- `behavior/<f>-api.ts`: add the procedure to the `<F>ApiMap` with contract input and
  output types. Never `AppRouter` (ADR-130); the segment names are the cache key.
- `behavior/use-<thing>.ts`: the hook. Mutations read failures with `readHandledError`
  and map `meta.fieldErrors` onto the form.
- `ui/elements` / `ui/blocks` for new presentation, `ui/sections` where it meets data,
  the screen composes it. A new host need (a fact or an action from the application) is a
  method on the `*HostPort` in `model/<f>-host.ts`, implemented in
  `apps/ui/src/features/<f>/ui/sections/<f>-host.tsx` and in `src/testing.tsx`'s stub.
- Copy per `dev/docs/best_practices/copywriting.md`; patterns per the `design-system`
  skill.
- Component tests `.integration.test.tsx` (jsdom docblock) bind the UI scenarios.

## 5. Composition

A new peer token the app declares must be provided where the module is installed:
`.withProvided(PeerApi, peer)` in `apps/api/src/features/<f>/<f>.composition.ts` (and the
worker root that installs the same server, if any). Boot names a missing provider before
constructing anything; do not add an optional parameter, a `refusing*` variant or a
`Logged*Absence`. See `.claude/skills/architecture-guide/references/config-composition.md`.
A new namespace or REST family also touches `app-trpc.features.ts` / the REST mount
(sections 6 and 7 say where).

## 6. Adding a REST endpoint

Declare its params, query, body and response schemas in the module's contract, add the
operation to the `<Feature>Api`, write the inline handler on the module's flat
`transport/<f>.rest.ts` declaration (`defineRestRouter` from `@langwatch/api/rest`) with
its permission and docs, mount the declaration through the process's REST family in
`apps/api/src/features/<f>/<f>-rest.mount.ts`, regenerate the OpenAPI description with the
task instead of hand-editing the frozen document, and bind the scenario. The reference
implementation is `annotation`, end to end:

```
modules/annotation/contract/src/annotation-rest.schemas.ts   params, query, body and response schemas
modules/annotation/contract/src/annotation.api.ts            the operation the handler calls
modules/annotation/server/src/transport/annotation.rest.ts   the declaration with inline handlers
apps/api/src/features/annotation/annotation-rest.mount.ts              the process mount
packages/api/src/rest/runtime.ts · index.ts                            defineRestRouter and createRestRuntime
```

`transport/api-rest/**` and `transport/public-rest/**` are the older spelling; a module
that still has one is listed in `packages/architecture-lint/src/feature-shape-baseline.json`
(`nested-transport`). New endpoints go on the flat declaration even in such a module; if
the module has no flat declaration yet, create `transport/<f>.rest.ts` and mount it (step
6.3) rather than adding to the folder.

### 6.1. Declare the shapes in the contract

In `<f>-rest.schemas.ts`: a params schema whose keys are exactly the `:name` segments of
the path, a query schema, a body schema, and the response schemas. Keys must not collide
across params, query and body (the framework merges them into one `input`).

```ts
export const annotationRestParamsSchema = z.object({ id: z.string().min(1) });
export const annotationRestQuerySchema = z.object({ anchor: annotationAnchorScopeSchema.default("all") });
export const annotationRestWriteSchema = z.object({ comment: z.string().min(1), isThumbsUp: z.boolean() });
export const annotationRestResponseSchema = z.object({ data: z.looseObject(annotationSchema.shape) });
```

The operation the handler will call is a method on `interface <F>Api` in `<f>.api.ts`;
add it there if it is new (section 2 above), and the app implements it.

### 6.2. Write the handler on the declaration

`modules/<f>/server/src/transport/<f>.rest.ts`:

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

`withNamespace` is the family name and the base path (`/api/annotations`); the process
mount reads it from the declaration instead of restating it. A route without
`withOutput` answers 204; a params schema whose keys differ from the path's `:params`
does not compile; a route without `withPermission` has no `handle` to call.

- `.get/.post/.patch/.put/.delete(path, operationId)`: the path is relative to the
  family's base path, the operation id is unique across every mount.
- `.withParams` / `.withQuery` / `.withInput` declare the sources; `input` is their merge,
  already parsed. `.withOutput` is mandatory for any route that returns a value; a
  no-content route declares none and returns `void`.
- `.withPermission(permission)` names the `AuthzPermission` the framework checks against
  the authorized `scope` (`{ tier: "project", id }`) before the handler runs; a route
  without one must say why with the declared alternative kinds (`withoutPermission`).
- The handler reads `{ app, input, actor, scope, signal }`, calls exactly one app
  operation and returns a value. It never touches a repository, constructs a service,
  reads a header or `process.env`, or builds a `Response`; throw the contract's
  `HandledError` and the framework serialises it.
- `.withVersion` is the date-based version of the whole declaration; bump it only when
  the wire shape changes for existing callers.
- Export the declaration from the server package `index.ts` and list it in
  `<f>.server.ts`'s `.withTransports(...)`.

### 6.3. Mount it in apps/api

The mount owns everything process-specific: how the caller is authenticated, which
credential, the base path, historical refusal bodies for callers that depend on them.
`apps/api/src/features/<f>/<f>-rest.mount.ts` builds a `createRestRuntime` and mounts the
declaration on it, modelled on annotation's:

```ts
export function mountAnnotationRest(options: {
  annotations: () => AnnotationApi;
  credential: ApiHandlerManagedCredentialPort;
}): MountableRestApp {
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }) => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new AnnotationRefusal(credential.status, credential.body);
        return { actor: null, scope: { tier: "project", id: credential.project.id }, markUsed: credential.markUsed };
      },
    },
  });

  return runtime.mount(annotationRest.router(), {
    app: options.annotations,
    credential: "projectKey",
    onError: annotationErrorHandler,   // maps this family's historical refusal bodies
  });
}
```

There is no `security.createServiceVersionedApp(...)` or `mountProjectTransport(...)` any
more; both builders are deleted. `createRestRuntime` and its `.mount(router, options)`
are the current shape; copy `apps/api/src/features/annotation/annotation-rest.mount.ts`
rather than an older mount file that still names the deleted builders (a lint or grep hit
on either name in a file you are not touching is conversion debt to name in the report,
not a pattern to extend). The root (`apps/api/src/app/api-production.composition.ts`)
registers the family only when the module was installed. A brand-new family is also added
to `apps/api/src/tasks/openapi-document/openapi-document.surface.ts` so the description
covers it.

### 6.4. OpenAPI

```bash
pnpm --filter @langwatch/platform-api task openapi-generate /tmp/openapi.json
pnpm --filter @langwatch/platform-api task openapi-check /tmp/openapi.json
```

`openapi-generate` describes the routes this process serves and never writes
`apps/api/src/features/discovery/openapi-document.json`: that artifact is frozen, routes
serve it and both SDKs generate clients from it, so replacing it is a decision a person
makes with the diff in front of them. Never hand-edit it. `openapi-check` fails only in
the breaking direction: the frozen document lists an operation no route serves.

### 6.5. REST tests

- `modules/<f>/server/src/transport/__tests__/<f>.rest.integration.test.ts`:
  mount the declaration through the harness host over `create<F>TestApp()` and assert the
  golden path, the refusal for each declared error, and a call without the permission.
- `apps/api/src/features/<f>/__tests__/<f>.composition.integration.test.ts` drives the
  real mount with `createApiFixture` peers.
- Assert on error `code` and status, never on message prose.

## 7. Adding a tRPC procedure

The contract input schema and `<Feature>Api` operation, the procedure declared once in the
contract's `<f>.trpc.ts` (`defineTrpcContract` from `@langwatch/api/contract`: name, kind,
input, output), its permission and handler bound in the server's flat
`transport/<f>.trpc.ts` (`defineTrpcRouter` from `@langwatch/api/trpc`), the API-side
mount in `apps/api/src/features/<f>/<f>-trpc.mount.ts` and the namespace in
`app-trpc.features.ts`, and the browser client derived from the contract (`ContractApiMap`,
never `AppRouter`, ADR-130) plus its hook. The reference is `annotation`:

```
modules/annotation/contract/src/annotation-trpc.schemas.ts       input schemas
modules/annotation/contract/src/annotation.trpc.ts               the `annotation.*` declaration (defineTrpcContract)
modules/annotation/contract/src/annotation-score.trpc.ts         the `annotationScore.*` declaration
modules/annotation/contract/src/annotation.api.ts                the operations the handlers call
modules/annotation/server/src/transport/annotation.trpc.ts       the `annotation.*` binding (defineTrpcRouter)
modules/annotation/server/src/transport/annotation-score.trpc.ts the `annotationScore.*` binding
apps/api/src/features/annotation/annotation-trpc.mount.ts                  the mount (runtime.mount)
apps/api/src/app-trpc/app-trpc.features.ts · app-trpc.composed.ts          the namespaces and the composed slot
modules/annotation/web/src/behavior/annotation-api.ts            the browser client, derived from the contract
```

tRPC is the first-party browser transport only. Public integrations get REST (ADR-128,
section 6 above). A `transport/api-trpc/<f>.api.ts` folder is the older spelling
(`feature-shape: nested-transport`); add new procedures to the contract declaration and
its flat binding, creating `contract/src/<f>.trpc.ts` and `server/src/transport/<f>.trpc.ts`
if the module has none yet.

A procedure is stated once. The contract names it, its kind, its input and its output;
the server binds a permission and a handler to that name and repeats nothing; the browser
derives its client from the contract's type. Design:
`packages/api/adrs/20260908-transport-declaration-split.md`; spec:
`packages/api/specs/transport-declaration-split.feature`.

### 7.1. Spec first

Golden path plus each named refusal, tagged and bound per the `spec-bind` skill.

### 7.2. Contract: declare the procedure

The input schema goes in `<f>-trpc.schemas.ts` (`<f>ApiCreateInputSchema`, with the
`projectId` the permission is checked against as a required field). The output is a
contract schema (`annotationSchema`, `annotationScoreSchema.array()`). The operation is a
method on `interface <F>Api` in `<f>.api.ts`; a new failure gets a `HandledError` subclass
in `<f>.errors.ts`, its code added to `packages/handled-error/src/app-codes.ts` and its
copy to `packages/handled-error/src/presentation.ts` in the same change.

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

- `.query(name)` / `.mutation(name)` / `.subscription(name)`, then `.withInput(schema)`;
  `.withOutput(schema)` states the answer, and omitting it declares a procedure that
  answers nothing (a handler returning data then does not compile).
- The file value-imports `@langwatch/api/contract`, `zod` and sibling schemas only. It is
  what the browser reads, so nothing server-side may reach it.
- Declaring the same name twice throws at module load; the wire name is the React Query
  cache key, so it is chosen once here and never spelled again.

### 7.3. Server: bind permission and handler

`modules/<f>/server/src/transport/<f>.trpc.ts`. One file per namespace; it
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

- `.procedure(name)` selects a member the contract declared; a name it did not declare,
  the same name twice, or `build()` with a member unimplemented does not compile (and
  `router(service)` throws by name at runtime as the second line).
- `.withPermission(...)` takes an `AuthzPermission` or an `AuthzDeclaration`, and the
  check reads its scope id from the **validated** input. A procedure that cannot take a
  permission states why with `noPermission({ reason })` or
  `serviceAuthorized({ reason, permissions, enforces })`;
  `apps/api/src/app-trpc/app-trpc.declared-check.ts` maps every kind to the middleware
  that enforces it and throws at boot on a kind it does not know. Without an access
  decision there is no `handle` to call.
- The handler reads `{ app, input, actor, scope, signal }`, typed from the contract's
  input, and calls exactly one app operation. Its return must satisfy the declared
  output. Small wire-to-domain mapping (`radioOptions(...)`) is a module-local function
  beside the binding; domain logic is not. No repositories, no services constructed, no
  `ctx`, no `process.env` (`api-transport-*` rules), no `TContext`/`TRoot`/mount type.
- Export the binding from the server package `index.ts` and list it in
  `<f>.server.ts`'s `.withTransports(...)`. Two namespaces from one module are two
  contract declarations and two bindings (`annotationTrpcTransport`,
  `annotationScoreTrpcTransport`).

### 7.4. Mount it in apps/api

`apps/api/src/features/<f>/<f>-trpc.mount.ts` reads the process context out of a typed
`HostContext` slice and calls `runtime.mount(declaration, selectApp)`:

```ts
export interface AnnotationHostContext {
  app: Readonly<{ annotation: AnnotationApi }>;
}

export function createAnnotationTrpcRouter<TContext extends AnnotationHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(annotationTrpcTransport, (ctx) => ctx.app.annotation);
}

export function createAnnotationScoreTrpcRouter<TContext extends AnnotationHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(annotationScoreTrpcTransport, (ctx) => ctx.app.annotation);
}
```

There is no `createTrpcHandlerBinding` / `createTrpcApiService` / `createTrpcService`
chain to hand-assemble any more; a mount file that still builds one is conversion debt
(`legacy-transport-runtime`), not a pattern to copy. `TrpcRuntime<TContext>` and
`.mount(declaration, selectApp)` are the current shape.

`<f>.composition.ts` returns `routers(mount) => ({ annotation: createAnnotationTrpcRouter(mount.runtime), … })`,
one entry per namespace; `apps/api/src/app-trpc/app-trpc.features.ts` names them
(`annotationScore: annotationRouters.annotationScore`) and the composed slot is declared
on `ComposedApiFeatures` in `app-trpc.composed.ts`. A new namespace touches those two
files; a new procedure on an existing namespace touches neither.

**Find where the namespace is mounted today before adding to it.** Only annotation is fully
on this path; other modules' namespaces may still be mounted directly in
`apps/api/src/api.application.ts` over a legacy `transport/api-trpc/` class, and a
feature-record key with the same name would silently replace it (and its React Query cache
key). Run
`grep -n "<namespace>" apps/api/src/app-trpc/app-trpc.features.ts apps/api/src/api.application.ts`.
When the namespace already exists on the legacy shape, mount the new flat declaration
beside it with `mount.root.mergeRouters(legacyRouter, newRouter)` under the one wire name,
as `governance` and `user` do in `app-trpc.features.ts`, and note the remaining legacy
router as conversion debt.

Test it: `apps/api/src/features/<f>/__tests__/<f>.composition.integration.test.ts` drives
the real mount with `createApiFixture` peers and a recording Prisma client.

### 7.5. The browser side

`modules/<f>/web/src/behavior/<f>-api.ts` derives the client from the contract;
a new procedure on a declared namespace needs no edit here:

```ts
type AnnotationProcedures = ContractApiMap<typeof annotationTrpc> & ContractApiMap<typeof annotationScoreTrpc>;
export const annotationApi = createFeatureApi<AnnotationProcedures>();
export type RouterOutputs = OutputsFromMap<AnnotationProcedures>;
```

- **Never name `AppRouter`** (ADR-130) and never write a procedure map by hand for a
  namespace this module declares. A procedure another module owns and this package
  still calls is the one hand-written exception, in a `BorrowedProcedures` type that says
  so until that module's contract declares it; `WireOf<T>` gives its serialised shape.
- **The segment names are load-bearing.** The contract's namespace (`"annotationScore"`)
  must be the key `app-trpc.features.ts` mounts, because tRPC hashes that path into the
  React Query cache key. A different spelling silently stops sharing a cache with every
  other call site.
- The hook goes in `behavior/use-<thing>.ts` and returns state and callbacks, never JSX.
  Mutation failures are read with `readHandledError` and rendered from the code-keyed
  registry; `meta.fieldErrors` maps onto the offending form fields.
- Component tests are `.integration.test.tsx` with the jsdom docblock, rendered inside
  the package's `Stub<F>Host`.

## 8. Gates

`.claude/skills/architecture-guide/references/gates.md`, scoped to what you touched.
`feature-shape` must not gain an entry for the module. For a transport change, add:

```bash
pnpm --filter @langwatch/<f>-contract test && pnpm --filter @langwatch/<f>-server test && pnpm --filter @langwatch/<f>-web test
pnpm --filter @langwatch/platform-api test:unit src/features/<f>/__tests__/<f>.composition.integration.test.ts
pnpm --filter @langwatch/<f>-server typecheck && pnpm --filter @langwatch/platform-api typecheck && pnpm --filter @langwatch/ui typecheck
```

Sabotage once: revert the service change and confirm the new test fails for the right
reason, then restore. A test that passes without the code guards nothing; a sabotage that
matched nothing is not evidence, so say when that happens.

## Report

Scenario titles and the tests that bind them; each layer's files; the error codes added;
whether a transport was added (operations with method/path/version and permission, or
namespace and procedure names, whether a namespace was added and the two files that
touched); gate numbers; anything left absent by design; whether the module still carries
legacy pieces you had to work beside.

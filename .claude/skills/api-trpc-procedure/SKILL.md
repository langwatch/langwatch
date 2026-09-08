---
name: api-trpc-procedure
description: "Add or change one tRPC procedure end to end the annotation way: the contract input schema and <Feature>Api operation, the procedure declared once in the contract's <f>.trpc.ts (defineTrpcContract from @langwatch/api/contract: name, kind, input, output), its permission and handler bound in the server's flat transport/<f>.trpc.ts (defineTrpcRouter from @langwatch/api/trpc), the API-side mount in apps/api/src/features/<f>/<f>-trpc.mount.ts and the namespace in app-trpc.features.ts, and the browser client derived from the contract (ContractApiMap, never AppRouter, ADR-130) plus its hook. Use whenever someone says 'add a tRPC procedure', 'a new mutation for the UI', 'the page needs this data', 'api.<x>.<y> does not exist', a procedure 404s or answers UNAUTHORIZED, or a React Query cache key is not shared with the rest of the app."
user-invocable: true
argument-hint: "<feature> <namespace.procedure, e.g. 'annotationScore.getAllActive'>"
---

# Add a tRPC procedure

Read `.claude/skills/architecture-guide/references/server.md` and `contract.md` first.
The reference is `annotation`:

```
packages/features/annotation/contract/src/annotation-trpc.schemas.ts       input schemas
packages/features/annotation/contract/src/annotation.trpc.ts               the `annotation.*` declaration (defineTrpcContract)
packages/features/annotation/contract/src/annotation-score.trpc.ts         the `annotationScore.*` declaration
packages/features/annotation/contract/src/annotation.api.ts                the operations the handlers call
packages/features/annotation/server/src/transport/annotation.trpc.ts       the `annotation.*` binding (defineTrpcRouter)
packages/features/annotation/server/src/transport/annotation-score.trpc.ts the `annotationScore.*` binding
apps/api/src/features/annotation/annotation-trpc.mount.ts                  the mount (context binding)
apps/api/src/app-trpc/app-trpc.features.ts · app-trpc.composed.ts          the namespaces and the composed slot
packages/features/annotation/web/src/behavior/annotation-api.ts            the browser client, derived from the contract
```

tRPC is the first-party browser transport only. Public integrations get REST
(ADR-128, `api-rest-route`). A `transport/api-trpc/<f>.api.ts` folder is the older spelling
(`feature-shape: nested-transport`); add new procedures to the contract declaration and
its flat binding, creating `contract/src/<f>.trpc.ts` and `server/src/transport/<f>.trpc.ts`
if the feature has none yet.

A procedure is stated once. The contract names it, its kind, its input and its output;
the server binds a permission and a handler to that name and repeats nothing; the browser
derives its client from the contract's type. Design:
`packages/api/adrs/20260908-transport-declaration-split.md`; spec:
`packages/api/specs/transport-declaration-split.feature`.

## 1. Spec first

Golden path plus each named refusal, tagged and bound per the `spec-bind` skill.

## 2. Contract: declare the procedure

The input schema goes in `<f>-trpc.schemas.ts` (`<f>ApiCreateInputSchema`, with the
`projectId` the permission is checked against as a required field). The output is a
contract schema (`annotationSchema`, `annotationScoreSchema.array()`). The operation is a
method on `interface <F>Api` in `<f>.api.ts`; a new failure gets a `HandledError` subclass
in `<f>.errors.ts`, its code added to `packages/handled-error/src/app-codes.ts` and its
copy to `packages/handled-error/src/presentation.ts` in the same change.

Then the procedure itself joins the namespace's declaration in
`packages/features/<f>/contract/src/<f>.trpc.ts` (one file per namespace):

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

## 3. Server: bind permission and handler

`packages/features/<f>/server/src/transport/<f>.trpc.ts`. One file per namespace; it
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
  `<f>.server.ts`'s `.withTransports(...)`. Two namespaces from one feature are two
  contract declarations and two bindings (`annotationTrpcTransport`,
  `annotationScoreTrpcTransport`).

## 4. Mount it in apps/api

`apps/api/src/features/<f>/<f>-trpc.mount.ts`:

```ts
function annotationService(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  const handlerBinding = createTrpcHandlerBinding<TContext, AnnotationApi>(async ({ ctx, input }) => ({
    app: ctx.app.annotation,
    actor: { type: "user", id: ctx.actor().id },
    scope: { tier: "project", id: annotationProjectScopeInputSchema.parse(input).projectId },
  }));
  const api = createTrpcApiService({ root: mount.root, protectedProcedure: mount.protectedProcedure, middlewares: mount.middlewares, handlerBinding });
  return createTrpcService({ root: mount.root, procedures: api, handlerBinding: api.handlerBinding });
}

export function createAnnotationScoreTrpcRouter(mount) {
  return annotationScoreTrpcTransport.router(annotationService(mount));
}
```

The mount owns the process context: where the app comes from (`ctx.app.<f>`), who the
actor is, how the project scope is read. `<f>.composition.ts` returns `routers(mount)`
with one entry per namespace; `apps/api/src/app-trpc/app-trpc.features.ts` names them
(`annotationScore: annotationRouters.annotationScore`) and the composed slot is declared
on `ComposedApiFeatures` in `app-trpc.composed.ts`. A new namespace touches those two
files; a new procedure on an existing namespace touches neither.

**Find where the namespace is mounted today before adding to it.** Only annotation is fully
on this path; other features' namespaces may still be mounted directly in
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

## 5. The browser side

`packages/features/<f>/web/src/behavior/<f>-api.ts` derives the client from the contract;
a new procedure on a declared namespace needs no edit here:

```ts
type AnnotationProcedures = ContractApiMap<typeof annotationTrpc> & ContractApiMap<typeof annotationScoreTrpc>;
export const annotationApi = createFeatureApi<AnnotationProcedures>();
export type RouterOutputs = OutputsFromMap<AnnotationProcedures>;
```

- **Never name `AppRouter`** (ADR-130) and never write a procedure map by hand for a
  namespace this feature declares. A procedure another feature owns and this package
  still calls is the one hand-written exception, in a `BorrowedProcedures` type that says
  so until that feature's contract declares it; `WireOf<T>` gives its serialised shape.
- **The segment names are load-bearing.** The contract's namespace (`"annotationScore"`)
  must be the key `app-trpc.features.ts` mounts, because tRPC hashes that path into the
  React Query cache key. A different spelling silently stops sharing a cache with every
  other call site.
- The hook goes in `behavior/use-<thing>.ts` and returns state and callbacks, never JSX.
  Mutation failures are read with `readHandledError` and rendered from the code-keyed
  registry; `meta.fieldErrors` maps onto the offending form fields.
- Component tests are `.integration.test.tsx` with the jsdom docblock, rendered inside
  the package's `Stub<F>Host`.

## 6. Gates

`.claude/skills/architecture-guide/references/gates.md`, plus:

```bash
pnpm --filter @langwatch/<f>-contract test && pnpm --filter @langwatch/<f>-server test && pnpm --filter @langwatch/<f>-web test
pnpm --filter @langwatch/platform-api test:unit src/features/<f>/__tests__/<f>.composition.integration.test.ts
pnpm --filter @langwatch/platform-api typecheck && pnpm --filter @langwatch/ui typecheck
```

## Report

The namespace and procedure names, the permission or declaration each carries, whether a
namespace was added (and the two files it touched), the hook added, the scenarios and
their bindings.

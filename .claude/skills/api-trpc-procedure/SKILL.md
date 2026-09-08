---
name: api-trpc-procedure
description: "Add or change one tRPC procedure end to end the annotation way: the contract input schema and <Feature>Api operation, the inline handler on the feature's flat transport/<f>.trpc.ts declaration (defineTransport from @langwatch/api/trpc) with its declared permission, the API-side mount in apps/api/src/features/<f>/<f>-trpc.mount.ts and the namespace in app-trpc.features.ts, and the browser's behavior/<f>-api.ts map slot typed from contract types (never AppRouter, ADR-130) plus its hook. Use whenever someone says 'add a tRPC procedure', 'a new mutation for the UI', 'the page needs this data', 'api.<x>.<y> does not exist', a procedure 404s or answers UNAUTHORIZED, or a React Query cache key is not shared with the rest of the app."
user-invocable: true
argument-hint: "<feature> <namespace.procedure, e.g. 'annotationScore.getAllActive'>"
---

# Add a tRPC procedure

Read `.claude/skills/architecture-guide/references/server.md` and `contract.md` first.
The reference is `annotation`:

```
packages/features/annotation/contract/src/annotation-trpc.schemas.ts       input schemas
packages/features/annotation/contract/src/annotation.api.ts                the operations
packages/features/annotation/server/src/transport/annotation.trpc.ts       the `annotation.*` declaration
packages/features/annotation/server/src/transport/annotation-score.trpc.ts the `annotationScore.*` declaration
apps/api/src/features/annotation/annotation-trpc.mount.ts                  the mount (context binding)
apps/api/src/app-trpc/app-trpc.features.ts · app-trpc.composed.ts          the namespaces and the composed slot
packages/features/annotation/web/src/behavior/annotation-api.ts            the browser map
```

tRPC is the first-party browser transport only. Public integrations get REST
(ADR-128, `api-rest-route`). A `transport/api-trpc/<f>.api.ts` folder is the older spelling
(`feature-shape: nested-transport`); add new procedures to the flat declaration, creating
`transport/<f>.trpc.ts` if the feature has none yet.

The declaration is about to split (`references/server.md`, "Where transports are going"):
the contract will name each procedure with its input and output
(`defineTrpcContract`), the server will bind permission and handler to that name
(`defineTrpcRouter`), and the browser will derive its client from the contract. Write the
procedure today so that move is a cut and paste: the input schema in
`<f>-trpc.schemas.ts`, the output a contract schema, the wire name the same in the
declaration and the web map.

## 1. Spec first

Golden path plus each named refusal, tagged and bound per the `spec-bind` skill.

## 2. Contract

The input schema goes in `<f>-trpc.schemas.ts` (`<f>ApiCreateInputSchema`, with the
`projectId` the permission is checked against as a required field). The output is a
contract schema (`annotationSchema`, `annotationScoreSchema.array()`). The operation is a
method on `interface <F>Api` in `<f>.api.ts`; a new failure gets a `HandledError` subclass
in `<f>.errors.ts`, its code added to `packages/handled-error/src/app-codes.ts` and its
copy to `packages/handled-error/src/presentation.ts` in the same change.

## 3. The declaration

`packages/features/<f>/server/src/transport/<f>.trpc.ts`. One file per namespace; it
constructs nothing:

```ts
export const annotationScoreTrpcTransport = defineTransport(AnnotationApi)
  .withRouter((router) =>
    router
      .query("getAllActive", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(annotationScoreSchema.array())
          .withPermission("annotations:view")
          .handle(async ({ app, input }) => app.listScores({ projectId: input.projectId, activeOnly: true })),
      )
      .mutation("upsert", (p) =>
        p
          .withInput(upsertInputSchema)
          .withOutput(annotationScoreSchema)
          .withPermission("annotations:manage")
          .handle(async ({ app, input, actor }) => app.upsertScore({ ...toUpsertInput(input), actorId: actor.id })),
      ),
  );
```

- `.query(name, …)` / `.mutation(name, …)`; `.withInput` and `.withOutput` are mandatory.
- `.withPermission(...)` takes an `AuthzPermission` or an `AuthzDeclaration`. The check
  reads its scope id from the **validated** input, which is why it is declared after
  `.withInput`. A procedure that cannot take a permission states why with the declaration
  kinds `noPermission({ reason })` or `serviceAuthorized({ reason, permissions, enforces })`;
  `apps/api/src/app-trpc/app-trpc.declared-check.ts` maps every kind to the middleware
  that enforces it and throws at boot on a kind it does not know.
- The handler reads `{ app, input, actor, scope, signal }` and calls exactly one app
  operation. Small wire-to-domain mapping (`radioOptions(...)`) is a module-local function
  beside the declaration; domain logic is not. No repositories, no services constructed,
  no `ctx`, no `process.env` (`api-transport-*` rules).
- Export the declaration from the server package `index.ts` and list it in
  `<f>.server.ts`'s `.withTransports(...)`. Two namespaces from one feature are two
  declarations (`annotationTrpcTransport`, `annotationScoreTrpcTransport`).

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

`packages/features/<f>/web/src/behavior/<f>-api.ts` declares the map:

```ts
export type AnnotationApiMap = {
  annotationScore: {
    getAllActive: { query: { input: ProjectScope; output: WireOf<AnnotationScore>[] } };
    upsert: { mutation: { input: AnnotationScoreUpsertInput; output: WireOf<AnnotationScore> } };
  };
};
export const annotationApi = createFeatureApi<AnnotationApiMap>();
```

- **Never name `AppRouter`** (ADR-130). Type every slot from the contract's own types;
  `WireOf<T>` gives the serialised shape (dates as strings); never `any`.
- **The segment names are load-bearing.** `annotationScore` here must be the namespace
  `app-trpc.features.ts` mounts, because tRPC hashes that path into the React Query cache
  key. A different spelling silently stops sharing a cache with every other call site.
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
namespace was added (and the two files it touched), the map slot and hook added, the
scenarios and their bindings.

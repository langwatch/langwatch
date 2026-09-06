---
name: api-trpc-procedure
description: "Add or change one tRPC procedure end to end: the contract schema, the transport/api-trpc router fragment with its declared permission, the API-side composition and mount in apps/api/src/features/<f>, the ComposedApiFeatures slot and app-trpc.features.ts namespace, and the browser's behavior/<f>-api.ts map slot typed from contract types (never AppRouter, ADR-130) plus its hook. Use whenever someone says 'add a tRPC procedure', 'a new mutation for the UI', 'the page needs this data', 'api.<x>.<y> does not exist', a procedure 404s or answers UNAUTHORIZED, or a React Query cache key is not shared with the rest of the app."
user-invocable: true
argument-hint: "<feature> <namespace.procedure, e.g. 'topics.getAll'>"
---

# Add a tRPC procedure

Read `.claude/skills/architecture-guide/references/server.md` and `contract.md` first.
The smallest complete example is `topic`:

```
packages/features/topic/contract/src/topic.ts                     schemas
packages/features/topic/server/src/transport/api-trpc/topic.api.ts  the fragment
apps/api/src/features/topic/topic-trpc.mount.ts                   the mount
apps/api/src/features/topic/topic.composition{,.types}.ts         the composition
apps/api/src/app-trpc/app-trpc.composed.ts · app-trpc.features.ts the slot and namespace
packages/features/secret/web/src/behavior/secret-api.ts           the browser map
```

tRPC is the first-party browser transport only. Public integrations get REST
(ADR-128, `api-rest-route`).

## 1. Spec first

Golden path plus each named refusal, tagged and bound per the `spec-bind` skill.

## 2. Contract

Input and output schemas in `<subject>.queries.ts` / `<subject>.commands.ts`, types by
`z.infer`. The abstract service in `<subject>.service.ts` gains the method. A new failure
gets a `HandledError` subclass in `<subject>.errors.ts`, its code added to
`packages/handled-error/src/app-codes.ts` and its copy to
`packages/handled-error/src/presentation.ts` in the same change.

## 3. The router fragment

`packages/features/<f>/server/src/transport/api-trpc/<subject>.api.ts`. It receives the
process's root, its authenticated procedure and its policy decorator; it constructs
nothing:

```ts
export type TopicTrpcContext = Readonly<{ app: Readonly<{ topics: TopicService }> }>;

export class TopicTrpcApi {
  static create(trpc, procedures) {
    const { protected: procedure, policy } = procedures;
    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput: procedures.validateOutput,
    })
      .query("getAll", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(topicSchema.array())
          .withPermission("traces:view")
          .handle(
            async ({ ctx, input }) => await ctx.app.topics.getAll({ projectId: input.projectId }),
          ),
      )
      .build();
  }
}
```

- `.withPermission(...)` takes an `AuthzPermission` or an `AuthzDeclaration`. The check
  reads its scope id from the **validated** input, which is why the policy is applied
  after `.input()` and never composed ahead of it.
- A procedure that cannot take a permission states why with the declaration kinds
  `noPermission({ reason })` or `serviceAuthorized({ reason, permissions, enforces })`.
  `apps/api/src/app-trpc/app-trpc.declared-check.ts` maps every declaration kind to the
  middleware that enforces it and throws at boot on a kind it does not know — an
  unenforced procedure fails at composition, not at first call.
- The fragment reads `ctx.app.<slice>` and nothing else. No repositories, no services
  constructed here, no `process.env` (`api-transport-*` rules).
- Export it from the server package `index.ts` with its context type.

## 4. Compose it in apps/api

`apps/api/src/features/<f>/`:

- `<f>-trpc.mount.ts` — `createXTrpcRouter(mount)` calling
  `XTrpcApi.create(mount.root, createTrpcApiService(mount))`.
- `<f>.composition.ts` — builds the service from `ApiTrpcInfrastructure` (the process's
  Prisma, Redis, ClickHouse handles) and returns `{ service, router }`. A process that
  composed no substrate returns the refusing variant: the namespace still mounts and
  every call refuses by name with a `*UnavailableError`, so the page says the deployment
  cannot answer rather than reporting an empty list.
- `<f>.composition.types.ts` — the `Composed<F>Feature` type. Kept separate so importing
  the router type pulls in no adapters.

Adding a namespace: declare the slot on `ComposedApiFeatures` in
`apps/api/src/app-trpc/app-trpc.composed.ts` only when the process must compose the
feature before the tRPC mount exists (its application is also read by `ctx.app` or by a
REST family). Otherwise compose it inside the record literal. Then name the namespace in
`apps/api/src/app-trpc/app-trpc.features.ts` (`topics: composed.topic.router(mount)`),
and thread the composition from `apps/api/src/app/api-trpc-features.composition.ts`.

Test it: `apps/api/src/features/<f>/__tests__/<f>.composition.unit.test.ts` proves both
legs — built with collaborators, refusing by name without them.
`apps/api/src/__tests__/api.application.secret-trpc.integration.test.ts` is the idiom for
a caller-level test through the real mount.

## 5. The browser side

`packages/features/<f>/web/src/behavior/<f>-api.ts` declares the map:

```ts
export type SecretApiMap = {
  secrets: {
    list: { query: { input: ListSecretsInput; output: Secret[] } };
    create: { mutation: { input: CreateSecretInput; output: Secret } };
  };
};
export const secretApi = createFeatureApi<SecretApiMap>();
```

- **Never name `AppRouter`** (ADR-130). Type every slot from the contract's own types;
  never `any`.
- **The segment names are load-bearing.** `secrets` here must be the namespace
  `app-trpc.features.ts` mounts, because tRPC hashes that path into the React Query cache
  key. A different spelling silently stops sharing a cache with every other `api.secrets.*`
  call site.
- The hook goes in `behavior/use-<thing>.ts` and returns state and callbacks, never JSX.
  Mutation failures are read with `readHandledError` and rendered from the code-keyed
  registry; `meta.fieldErrors` maps onto the offending form fields.
- Component tests are `.integration.test.tsx` with the jsdom docblock.

## 6. Gates

`.claude/skills/architecture-guide/references/gates.md`, plus:

```bash
pnpm --filter @langwatch/<f>-contract test && pnpm --filter @langwatch/<f>-server test && pnpm --filter @langwatch/<f>-web test
pnpm --filter @langwatch/platform-api test:unit run src/features/<f>/__tests__/<f>.composition.unit.test.ts
pnpm --filter @langwatch/platform-api typecheck && pnpm --filter @langwatch/ui typecheck
```

## Report

The namespace and procedure names, the permission or declaration each carries, the
composition slot touched, the map slot and hook added, the scenarios and their bindings,
and any absence still named at boot.

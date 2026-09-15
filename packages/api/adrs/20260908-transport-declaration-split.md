# Transport declaration split: a contract the browser reads, a server that binds to it

**Date:** 2026-09-08

**Status:** Accepted

**Behavioural contract:** [Transport declaration split](../specs/transport-declaration-split.feature)

**Related:** [ADR-133: one feature installer, one construction path](../../../dev/docs/adr/133-composition-spec.md),
[API ADR-006: the tRPC fluent chain](./006-trpc-fluent-chain.md),
[API ADR-001: RPC-first fluent registration](./001-rpc-first-fluent-registration.md),
[API ADR-028: the tRPC framework boundary](./20260828-trpc-framework-boundary.md)

## Context

A tRPC procedure was described three times.

The feature's server wrote the name, the kind, the input schema, the output
schema, the permission and the handler in one chain. The feature's contract
held the schemas that chain named. The feature's **web** package then wrote the
whole thing again by hand — `modules/annotation/web/src/behavior/annotation-api.ts`
was 281 lines of a nested `AnnotationApiMap` whose own comment said it was
"hand-written until the mounted router can generate it".

Two of those three could disagree, and did. The map declared
`markQueueItemDone` answering `{ id: string } | null`; the procedure answers a
ten-field queue item. It declared `annotationScore.toggle` answering `unknown`;
the procedure answers a score. It declared `annotationScore.upsert` taking a
`dataType: string`; the procedure takes an enum of five. None of those
disagreements could be caught, because nothing tied the browser's description
to the server's.

The declarations also dragged the process's generics into the feature.
`TrpcTransportRouter<Api>` (the old `packages/api/src/trpc/transport.ts`) was a
function generic in `TContext`, `TOptions` and `TRoot`, so
`apps/api/src/features/annotation/annotation-trpc.mount.ts` spent sixty lines
threading three type parameters a feature has no opinion about.

## Decision

**A contract declares each tRPC procedure once. The server binds a permission
and a handler to a name the contract already declared. REST stays one complete
declaration per route.**

### `defineTrpcContract`, on the new `@langwatch/api/contract` entry

```ts
export const annotationTrpc = defineTrpcContract("annotation")
  .query("getById").withInput(annotationApiAnnotationScopeSchema).withOutput(annotationSchema)
  .mutation("deleteById").withInput(annotationApiAnnotationScopeSchema)
  .build();
```

The entry is browser-safe by construction: `src/contract/trpc-contract.ts`
value-imports nothing at all (`zod` arrives as `import type`), and a unit test
reads its own source to keep it that way. A namespace is the first segment of
the browser's React Query cache key, so it is also the mounted name.

`withInput` is mandatory; `withOutput` is not. A procedure declared without an
output answers nothing, and a handler that returns data for one does not
compile.

### `defineTrpcRouter`, on `@langwatch/api/trpc`

```ts
export const annotationTrpcTransport = defineTrpcRouter(AnnotationApi, annotationTrpc)
  .procedure("getById").withPermission("annotations:view").handle(async ({ app, input }) => …)
  .procedure("deleteById").withPermission("annotations:delete").handle(async ({ app, input }) => …)
  .build();
```

`.procedure(name)` selects a declared member and inherits its kind, its parser
and its answer. The server states the two things the contract cannot: who may
call it, and what it does. The access vocabulary is unchanged —
`withPermission`, `noPermission`, `serviceAuthorized`.

The declaration carries **no process generic**. `router(service)` is where the
host's root, context and policy arrive, and it drives the same
`createTrpcService` chain every existing feature runs on — the parser first,
then the policy, then the output check — rather than a second copy of it. That
is what "one execution path" means here: the new front door is a different way
to *state* a procedure, not a different way to *run* one.

### `defineRestRouter`, on `@langwatch/api/rest`

```ts
export const annotationRest = defineRestRouter(AnnotationApi)
  .withNamespace("annotations")
  .withVersion(MANAGEMENT_API_VERSION)
  .get("/:id", "getAnnotation").withParams(S).withPermission(P).withOutput(O).withDocs(D).handle(h)
  .build();
```

REST keeps one complete declaration per route, because it has no browser half
to share a declaration with. What is new is `withNamespace`: the family's path
segment now travels **with** the declaration, so
`apps/api/src/features/annotation/annotation-rest.mount.ts` reads
`/api/${declaration.namespace}` rather than restating the string.

### The browser derives its client

`@langwatch/api/web` gained `ContractApiMap<TContract>`, which turns
a contract's type into the `ModuleApiMap` shape `createModuleApi` already
took. The annotation web package went from 281 lines of hand-written map to

```ts
type AnnotationProcedures = ContractApiMap<typeof annotationTrpc> &
  ContractApiMap<typeof annotationScoreTrpc> &
  BorrowedProcedures;
```

`WireOf` and `OutputsFromMap` are unchanged and keep working over it, because
the derived map is the same shape the hand-written one was. The browser door
takes no zod dependency for this: `z.input` and `z.output` are themselves
indexed reads of a schema's `_zod` key, so the derivation reads the same key.

## Consequences

**The map cannot drift, because there is no map.** The three disagreements
listed above are gone by construction; every one of them was the derived type
being *wider or narrower* than the hand-written one, and every call site
compiles against the derived type unchanged.

**Six refusals are compile-time**, pinned twice: as `@ts-expect-error` lines in
`type-tests/transport-declaration-split.ts` (which the package typecheck
enforces) and as diagnostic assertions in
`src/trpc/__tests__/trpc-router.compiler.test.ts`.

| Refusal | Where it is refused |
| --- | --- |
| a procedure name the contract does not declare | `.procedure` parameter type; also a runtime throw naming the name |
| the same procedure implemented twice | `.procedure` parameter type; also a runtime throw naming the name |
| `build()` with a procedure unimplemented | `build`'s `this` type, which names the omitted procedure |
| `handle` before an access decision | `handle` does not exist until `withPermission`/`noPermission`/`serviceAuthorized` |
| data answered by a procedure declared without output | the handler's return type is `void \| Promise<void>` |
| a params schema whose keys are not the path's | `ExactPathSchema`, unchanged from the previous REST builder |

The two duplicate refusals are **also** runtime throws. The type refuses them
first; the throw is what a JavaScript caller and the mount itself hit, and it
names the procedure rather than failing silently with the last write winning.

**`defineTransport` is gone**, both the REST and the tRPC one. Annotation was
its only caller, and keeping a second front door beside the new one would have
made "one execution path" a claim rather than a fact.

### Leaves the core next

Neither is touched by this change, and both are named here so the next lane
does not have to rediscover them:

- **Audit redaction knows feature names.** `src/trpc/trpc-audit-redaction.ts`
  lists specific procedures. That belongs to the features that own them.
- **Media policy knows stored objects.** `src/rest/media-response.ts` knows a
  stored-object policy the framework should not.
- **Trailing middleware facts.** ADR-133 states that middleware may declare an
  output schema whose parsed value reaches the handler as an additional
  trailing argument. No middleware declares one today and the framework has no
  seam for it, so the handler argument set here is exactly
  `{ input, app, actor, scope, signal }` and the spec says so. Building the
  middleware seam is a separate change.

### What the next feature has to do

Convert a namespace at a time. Write the contract beside the schemas it already
has, point the server at it, and delete the web map. The wire is unchanged if —
and only if — every procedure name, namespace key, permission and schema
survives byte-identical; annotation's are pinned in
`modules/annotation/server/src/transport/__tests__/annotation.trpc.declaration.unit.test.ts`,
and the next feature should pin its own the same way before it starts.

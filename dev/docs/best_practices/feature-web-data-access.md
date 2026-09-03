# How feature web packages reach the server

A `packages/features/<feature>/web` package holds React that needs data. This is
where that data comes from, who owns the client, which tier a hook belongs in,
and what the pattern deliberately does not solve.

Read this before wiring data into any feature web package. Three lanes
stopped on the same sentence — "the hooks cannot leave until there is a settled
answer for how a feature web package reaches tRPC" — and this is that answer.

**Related:** [ADR-101](../adr/101-feature-package-surfaces.md) (feature package
surfaces), [ADR-045](../adr/045-domain-errors-handled-boundary.md) (handled
errors), [react.md](./react.md), [error-handling.md](./error-handling.md).

---

## The short version

```
┌──────────────────────────────────────────────────────────────────────────┐
│ apps/ui  (the browser process shell)                                     │
│                                                                          │
│   owns ONE tRPC client and ONE QueryClient, and mounts one Provider       │
│   per feature package. Reads the environment. Chooses links, batching,    │
│   transformer, WebSocket. Nothing else may.                              │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ hands over its client + its QueryClient
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ @langwatch/platform-api-client   (no feature role — this is why it can    │
│                                   name @trpc/server types)               │
│                                                                          │
│   createFeatureApi<Map>()   turns a feature's plain procedure map into    │
│                             a real @trpc/react-query binding             │
│   useInvalidateProcedure()  invalidate a procedure your map lacks         │
│   trpcQueryKey / Filter     tRPC's cache-key encoding, rebuilt            │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ declared as a dependency
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ packages/features/<feature>/web                                          │
│                                                                          │
│   <feature>-api.ts    the procedure MAP (payload types from the contract) │
│   use-*.ts            EXTERNAL hooks — exported, a contract               │
│   internal/use-*.ts   INTERNAL hooks — package-private                    │
│   *.tsx               components that know what a trace is                │
└──────────────────────────────────────────────────────────────────────────┘
```

The binding is still `@trpc/react-query`. **Cache keys, invalidation and
optimistic updates are byte-identical to what the application does today.** That
is the single most important property here and it is explained in full below.

---

## Where a browser component gets its typed client

**Where this is going:** `packages/platform-api-client` already exports a
single shared `trpcReact` built against `apps/api`'s root router type (see
`secret/web/src/behavior/secret-api.ts`). It is meant to replace the
per-feature `createFeatureApi<Map>()` maps described below once the api-map
lane finishes its fan-out (`dev/docs/plans/install-composition-review-2026-09-03.md`
§5). This section will be rewritten around `trpcReact` at that point.

From its own feature package, never from `~/utils/api` and never from a client
it builds itself.

```ts
// packages/features/trace/web/src/trace-api.ts
import { createFeatureApi } from "@langwatch/platform-api-client";
import type { TraceHeader, TraceHeaderReadInput } from "@langwatch/trace-contract";

export type TraceApiMap = {
  tracesV2: {
    header: { query: { input: TraceHeaderReadInput; output: TraceHeader } };
  };
};

export const traceApi = createFeatureApi<TraceApiMap>();
```

and then, anywhere in the package:

```ts
traceApi.tracesV2.header.useQuery(input, { staleTime: 300_000 });
traceApi.useUtils().tracesV2.header.invalidate({ projectId, traceId });
```

Which is the call the code already wrote as `api.tracesV2.header.useQuery(...)`
while it lived in the application. That is deliberate: the migration should be a
change of import, not a change of idiom.

### What a feature package declares to receive it

One dependency and one map. That is the whole contract.

```jsonc
// packages/features/<feature>/web/package.json
"dependencies": {
  "@langwatch/platform-api-client": "workspace:*",
  "@langwatch/<feature>-contract": "workspace:*"
}
```

It does **not** declare `@trpc/client`, `@trpc/react-query`, `@trpc/server` or
`@tanstack/react-query`. It does not build a client, choose a URL, or mount a
Provider.

### Why the package cannot just own the client outright

Two hard walls, both worth knowing before someone tries to route around them.

1. **A web package may not import `@trpc/server`, even as a type.**
   `packages/architecture-lint/oxlint-plugin.mjs:340-348` rejects it for the
   `web` role and `:340-345` for `contract` as well. The rule fires from
   `ImportDeclaration` and never inspects `importKind`, so `import type` is
   rejected exactly like a value import. Since `AnyRouter`,
   `TRPCQueryProcedure` and `TRPCBuiltRouter` all live there, a feature package
   cannot name a router type at all. Hence the plain `{ query: { input, output } }`
   map: it needs no tRPC types, and `@langwatch/platform-api-client` — which has
   no feature role and so is unclassified by that lint — converts it.

2. **A web package may not import its own feature's server package.**
   `manifests.ts:228` and `oxlint-plugin.mjs:301` both reject it, and ADR-101
   says so in prose: "It does not import a server package, including through a
   type-only import."

### And why the router type could not be imported even if the lint allowed it

This is the part worth internalising, because "just import the router type" is
the first thing everyone proposes. There is nothing to import.
`TracesV2TrpcApi.create` is generic over five parameters including the
process's context and its tRPC root, and it returns `trpc.router({...})` built
from the caller's root object. The concrete router type does not exist until
`apps/api` instantiates it, and `apps/api` is an application — packages do not
depend on applications. The feature server package genuinely has no stable
router type to export.

---

## The mounting, once, in the shell

```tsx
// apps/ui/src/ui/sections/ui-feature-shell.tsx:114-118
const mounted = apis.reduceRight<ReactNode>(
  (inner, { Provider }) => (
    <Provider client={ownTransport} queryClient={queryClient}>
      {inner}
    </Provider>
  ),
  <UiRpcContextProvider value={rpc}>
    <UiCapabilities transport={ownTransport}>{children}</UiCapabilities>
  </UiRpcContextProvider>,
);
```

One untyped client (`ownTransport`) is handed to every binding's `Provider` in
turn, `reduceRight` so the list reads in mount order at the call site. There is
no cast: `Provider` accepts the client as `unknown` at this call site, and each
feature's own binding — `createFeatureApi<Map>()` or `trpcReact` — supplies the
type on the way back out through its own hooks.

Two rules, and breaking either one is the cause of the bug class this whole
document exists to prevent:

- **Pass the shell's client, not a new one.** A second client is a second
  `httpBatchLink`, so a query fired by an application hook and one fired by a
  package hook in the same tick stop travelling in one request.
- **Pass the shell's `queryClient`.** A fresh QueryClient gives the package a
  private cache that no application invalidation can reach.

---

## Cache keys and invalidation: nothing changes, on purpose

The direct answer to "should we cache better on the generated hooks": **no —
keep the current semantics exactly.** Here is why that is the answer rather than
a dodge.

`@trpc/react-query` derives its React Query key from the procedure path alone.
From `getQueryKeyInternal`:

```
path only            ->  [["tracesV2", "list"]]
path + input         ->  [["tracesV2", "header"], { input }]
path + input + type  ->  [["tracesV2", "header"], { input, type: "query" }]
```

No client identity. No provider identity. Nothing distinguishing one
`createTRPCReact` instance from another. So:

```
   application                          feature package
   api.tracesV2.header.useQuery(i)      traceApi.tracesV2.header.useQuery(i)
            │                                        │
            └───────────────┬────────────────────────┘
                            ▼
              ONE QueryClient, ONE cache entry
              key: [["tracesV2","header"], { input: i, type: "query" }]
```

That is what makes the migration incremental rather than a cutover. Concretely,
in `traces-v2` today:

- `useTraceFreshness` (still in the application) invalidates `tracesV2.header`
  on an SSE event → a hook that has moved into the package refetches.
- `useOpenTraceDrawer` (still in the application) does
  `utils.tracesV2.header.setData(...)` to seed a row projection → a moved
  `useTraceHeader` reads that seed and renders instantly.
- A moved rename invalidates `tracesV2.list` → the application's
  `api.tracesV2.list.useQuery` refetches.

None of that needs coordination, and none of it survives a binding that invents
its own key namespace.

### The counter-example, since fixed

The platform host's Agent UI adapter keyed its reads `["agent-ui", path, input]`
and invalidated `["agent-ui"]` after every mutation. That key shares no prefix
with any tRPC key, so:

- nothing the application invalidates reaches the Agent adapter's cache, and
- nothing the Agent adapter writes is visible to `api.agents.*` hooks.

The same page mounts `api.agents.getAll.useQuery` alongside it, so Agent
management is running two disjoint caches over one procedure family. Symptom:
stale UI that looks random and gets blamed on something else. **Do not copy that
adapter.** Fixing it is a follow-up, listed at the end.

### Invalidating a procedure your map does not declare

Constant during the migration: a moved hook must invalidate something that has
not moved.

```ts
const invalidateProcedure = useInvalidateProcedure();
await invalidateProcedure("tracesV2.list");
```

It builds tRPC's own key from the path. Use it **only** when the map does not
declare the procedure; once it does, `utils.tracesV2.list.invalidate()` says the
same thing with the types checked. A typo in the string is a silent no-op, which
is exactly why it is the second choice and not the habit.

It also retires three hand-rolled key sites in `traces-v2` that are bugs waiting
to happen: `useVisibleTraceIds` reconstructs `useTraceListQuery`'s full input
object by hand to hit its key, `useTraceListRefresh` matches keys with
`JSON.stringify(q.queryKey[0]).includes('"tracesV2"')`, and `spanTreePagedQuery`
synthesises a key through `getQueryKey` for a query it never runs through tRPC.

### Optimistic updates

There are none to preserve in `traces-v2` — zero `onMutate`, zero rollback,
zero `onSettled` across all 65 hooks. When one is written, it is written the
ordinary React Query way against the ordinary tRPC key, because the key is the
ordinary tRPC key. Nothing in this pattern touches it.

---

## Two tiers inside a feature package: internal and external

Which tier a hook lands in is a decision per hook, not a default.

```
packages/features/trace/web/
  src/
    index.ts                   ← the public surface. Names every EXTERNAL thing.
    use-trace-header.ts        ← EXTERNAL: "what is this trace?"
    editable-trace-name.tsx    ← EXTERNAL component
    internal/
      use-rename-trace.ts      ← INTERNAL: Trace's own drawer does this
  package.json
    "exports": { ".": ... }    ← no entry reaches inside internal/
```

**How a reader tells them apart, without reading the implementation:** the path.
Anything under `src/internal/` is package-private, `src/index.ts` never exports
from `internal/`, and no `exports` entry reaches inside it — so another package
importing one is a module-resolution error, not a coupling nobody notices.

**External** means anything may ask this feature for that information.
`useTraceHeader` answers "what is this trace", and Langy, Scenario and
Experiment all want to. An external hook's argument and result types must come
from the feature's **contract** package, because a caller cannot depend on types
declared in a file it may not import.

**Internal** means the feature does this to itself. `useRenameTrace` is the
drawer's rename; nothing outside Trace renames traces. It may use types declared
in its own file.

**Default to internal.** Promotion is cheap; demotion is a breaking change for
every caller that appeared in between.

### What promoting one costs

Three things, and they are worth doing deliberately in a change of their own
rather than as a side effect of a second caller appearing:

1. **Types move to the contract package.** A hook whose argument type is
   declared in `internal/` cannot be called from outside; moving the type is
   most of the work.
2. **The name becomes something other packages compile against.** Renaming it
   later is a repo-wide change.
3. **The invalidation set becomes a promise.** `useRenameTrace` invalidating
   `header` and `list` is an implementation detail today. Exported, a caller
   will depend on the list refreshing, and narrowing it later breaks them
   silently — no type error, just a stale table.

### Which feature owns a hook

The feature that owns the **subject**, not the one that happens to call it. The
feature-flag hook goes to `packages/features/feature-flag/web`; auth hooks to
the auth feature; a hook that answers "what is this trace" to Trace, even if
only Langy calls it today. A hook used by exactly one screen of one feature and
answering a question about that feature's own state is internal to it. A hook
with no subject — `useDebouncedValue`, `useOverflowVisibility` — is not a
feature hook at all; it goes to a shared package or is deleted.

---

## UI components: design system or feature package

The line is what the component knows.

```
packages/design-system                 packages/features/<f>/web
──────────────────────────             ──────────────────────────
knows Chakra, tokens, a11y             knows what a trace is
takes strings, numbers, callbacks      takes TraceHeader, ScenarioRun
no feature vocabulary                  feature vocabulary throughout
no data access, ever                   may call its own feature's hooks

  Tooltip, Dialog, Drawer, Menu          EditableTraceName
  Popover, Select, Toaster               TracePeekSummary
  SearchInput, SegmentedControl          AgentCard
```

The reference uses this line both ways: `EditableTraceName` takes `Tooltip` and
`toaster` from `@langwatch/design-system` and contributes nothing back to it,
because a component that knows what a trace name is has no business there.

**A component that needs a router is not framework-free.**
`~/components/ui/link` cannot move as it stands: it renders through
`~/utils/compat/next-link`, so it needs a router the design system must not
know. The fix is one small piece of design — the design system owns the
presentational link and renders a plain `<a>` by default, and the shell injects
the router's link component once through a context. `FieldInfoTooltip` is
blocked only behind that, since its sole feature-ish dependency is `Link`.

**The other three named primitives are not missing — they are forked.**
`design-system` already has `dialog`, `drawer` and `toaster`;
the platform monolith carried divergent copies (174 vs 83, 179 vs 66,
220 vs 122 lines). That drawer imported `@langwatch/langy-web` for dock
gap, dodge stagger and sidebar width, which by the rule above makes it a Langy
component, not a primitive. Reconciling the three forks is a single-lane,
repo-wide job (529 importing files across dialog/drawer/toaster/link/
FieldInfoTooltip) and a behaviour decision per component — not an import sweep,
and not something to attempt while other lanes are editing those files.

---

## Worked example

The reference is `tracesV2.header` (read) and `tracesV2.changeName` (write) in
`@langwatch/trace-web`. It was chosen because it exercises every hard part: a
query with real options, a mutation that invalidates both a declared and an
undeclared procedure, two components, and — critically — a procedure that
application code still reads, writes with `setData` and prefetches, so a
cache-key mistake would be visible immediately.

### 1. The contract owns the payload types

`packages/features/trace/contract/src/trace-explorer.contract.ts`

```ts
export const traceHeaderReadInputSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  occurredAtMs: z.number().int().optional(),
  full: z.boolean().default(true),
});

export type TraceHeaderReadInput = z.input<typeof traceHeaderReadInputSchema>;
```

`z.input`, not `z.infer`. The procedure defaults `full` to `true`, so the
client-facing input has it optional while the parsed input has it required.
Getting this backwards makes a correct call site fail to compile, or an
incorrect one pass.

The same file holds `readChangeTraceNameRejection`, which turns the handled
error's `meta` into a typed reason. The *shape* of a rejection is the server's
and belongs in the contract; the *words* stay in the component (ADR-045).

### 2. The map, and the binding

`packages/features/trace/web/src/trace-api.ts` — shown at the top of this
document. Segment names are mount points on the root router and become the
cache key; spell one differently and the hooks quietly stop sharing a cache.

### 3. An external hook

`packages/features/trace/web/src/use-trace-header.ts`

```ts
export function useTraceHeader({ projectId, traceId, occurredAtMs, full, enabled = true,
  staleTimeMs = 300_000 }: TraceHeaderReadInput & { full: boolean; enabled?: boolean;
  staleTimeMs?: number }): { header: TraceHeader | undefined; isLoading: boolean } {
  const query = traceApi.tracesV2.header.useQuery(
    { projectId, traceId, ...(occurredAtMs !== void 0 ? { occurredAtMs } : {}), full },
    { enabled: enabled && projectId.length > 0 && traceId.length > 0, staleTime: staleTimeMs },
  );
  return { header: query.data, isLoading: query.isLoading };
}
```

It returns two fields, not the whole `UseQueryResult`. An external hook's return
type is a contract, and `refetch`, `isStale` and `dataUpdatedAt` are not things
Trace wants to promise other features. `full` has no default on purpose: the
procedure defaults it to `true`, which costs an extra spans read, and inheriting
that silently is how a hover-peek ends up paying a drawer's price.

### 4. An internal hook, with the invalidation

`packages/features/trace/web/src/internal/use-rename-trace.ts`

```ts
const mutation = traceApi.tracesV2.changeName.useMutation({
  onSuccess: async ({ traceId }, variables) => {
    await Promise.all([
      utils.tracesV2.header.invalidate({ projectId: variables.projectId, traceId }),
      invalidateProcedure("tracesV2.list"),   // not in the map yet
    ]);
  },
});
```

Both halves of the invalidation story in four lines: the declared procedure
through typed utils, the undeclared one through the path helper, and the second
reaching the application's own `api.tracesV2.list.useQuery` entries because the
key is the key tRPC would have built.

`rename` returns a `RenameTraceOutcome` rather than toasting. The component
decides the copy and whether to close the editor.

### 5. The components

`editable-trace-name.tsx` and `trace-peek-summary.tsx` moved out of
the platform monolith whole. Their only substantive change is that `projectId` arrives
as a prop instead of from `useOrganizationTeamProject`, and the toast comes from
`@langwatch/design-system/toaster`.

### 6. Proving it

`packages/platform-api-client/tests/trpc-query-key.unit.test.ts` asserts the load-
bearing property against tRPC's own `getQueryKey`: two independent
`createFeatureApi` instances derive identical keys, and `trpcQueryKey` matches
what tRPC produces for both the procedure-wide and the input-specific form. If
`@trpc/react-query` ever changes its encoding, that test fails instead of every
migrated hook silently detaching from its un-migrated siblings.

---

## Drift: the one thing nothing checks

The map is hand-written, and **nothing proves it matches the real router.** Be
clear-eyed about this.

What holds the two sides together today is weaker than a type check and stronger
than nothing: both take their payload types from the contract package, so an
input or output shape cannot drift without one of them failing to compile. What
is unchecked is the *path* — nothing catches `tracesV2` being renamed on the
router, or a procedure being removed. The failure mode is a runtime tRPC error
on that one call, not a broken build.

The check has to run where the real router type is in scope, and that is now
`apps/api/src/app-trpc` — the API process owns the root router since the
platform monolith was deleted, so both of these are unblocked and neither is
done yet:

1. Add `apps/api/src/app-trpc/app-trpc.conformance.ts` — a type-only file
   asserting each feature's map against the real router:

   ```ts
   type AssertMap<TMap, TRouter> = /* every path in TMap exists on TRouter
                                     with matching inferRouterInputs/Outputs */;
   type _Trace = AssertMap<TraceApiMap, AppRouter>;
   ```

2. Then **generate the maps** instead of asserting them. This is what the
   "auto generated tRPC clients based on the api" instruction is asking for and
   it is achievable at that point: walk the mounted router, emit one
   `<feature>-api.ts` per feature package, check the output in, and fail CI on a
   dirty regeneration. Repo convention is that tooling like this is a Go CLI
   (`tools/`), not a `tsx` script.

Until then: **add a procedure to a map when a hook needs it, never
speculatively.** Every entry is an unchecked promise.

---

## What this does not solve

Say so out loud rather than stretching the pattern.

**It does not move a hook whose real dependency is another app hook.** In
`traces-v2`, 36 of 65 hooks import `~/utils/api` — but 18 depend on
`useOrganizationTeamProject`, which is the larger blocker and is not a data
problem (see below). A hook that also needs `useDrawer`, `useRouter` or
`SharedTraceContext` is blocked on those, not on this.

**It does not help a hook that imports server code.** `useTraceHeader`,
`useSpanDetail`, `useSpanTree` and `useSpansFull` in `traces-v2` all import
`~/server/traces/edit-overlay/**`. That code must move to a browser-safe module
before those hooks can go anywhere.

**It has no answer for the vanilla-client escape hatch.**
`spanTreePagedQuery.ts` calls `getUntypedClient(...).query("tracesV2.spanTreePaginated", …)`
with a string path and an `AbortSignal`, because the typed proxy provably cannot
wrap that router — its `subscription` procedure collides with reserved proxy
method names. A feature package that needs raw client access needs an explicit
escape hatch this pattern does not currently define. Leave such a hook where it
is until it does.

**It does not make a package unit-testable for free.** Testing a hook that calls
`traceApi.*` needs a `QueryClientProvider` plus `traceApi.Provider` with a client
built on a fake link. That is real, it is about 25 lines of harness, and it is
better than the alternative — the one package that already runs React Query
internally, `@langwatch/ops-web`, has **no test at all** for its hooks, because
its transport is a module singleton nobody can substitute. Write the harness
once per package.

**It is not the pattern for a governed package.** `agent-web` and `prompt-web`
are listed in `apps/ui/src/features/catalogue.json` as `governedWebPackages`,
and `frontend-ui-boundaries.ts:94-103` forbids `@tanstack/react-query` and
`@trpc/client|react-query` anywhere in a governed screen or surface closure.
Those two packages take data through injected ports — the
`AgentBrowserPort` shape — and must keep doing so.

**This is a genuine fork in the road and someone has to settle it.** The
governance rules were written to keep screens transport-free; the evidence from
`traces-v2` is that for a cache-orchestrating feature the cache *is* the domain
model — 16 `setData` seeds, 25 invalidations, 6 `cancel`, 6 `prefetch`, and
three places that depend on the exact byte shape of a tRPC key. A port that
hides React Query cannot express that, and the Agent adapter's attempt to is the
`["agent-ui", ...]` bug. My recommendation: keep ports for imperative CRUD
screens, use this pattern for cache-orchestrating features, and either widen the
governed allowlist to permit `@langwatch/platform-api-client` in `behavior/` or
accept that Trace will not be a governed package. Do not silently do both.

---

## `useOrganizationTeamProject` — the actual blocker

Named as "heavy, bloated, used in too many places", and that is right: 770
lines, 24 importers inside the trace feature and 21 inside agent-testing, and it
gates hooks that have nothing to do with organizations.

It is at least seven hooks wearing one name:

| What it does | What it should be | Where |
| --- | --- | --- |
| Resolves org/team/project from the URL, with a `useLocalStorage` last-used team | `useProjectScope()` → `{ projectId, projectSlug, organizationId, teamId, isLoading }` | `features/project/web` |
| `hasPermission` / `hasOrgPermission` / `hasAnyPermission` | `useHasPermission()` | `features/authz/web` (does not exist yet) |
| Redirects to onboarding / project onboarding, resolves redirect sub-paths, reads the navigation-mode store | `useScopeRedirects({ ... })`, called by route shells only | `apps/ui` |
| Reads `modelProvider.getAllForProject` | `useModelProviders(projectId)` | `features/model-provider/web` |
| Substitutes `sharedTrace.get` for everything on the public share route | `useSharedTraceScope()` | `features/share/web` |
| Swaps the project slug in demo mode from `publicEnv` | `useDemoProject()` | `features/project/web` |
| Requires a session and redirects without one | already `useRequiredSession` | `features/auth/web` |

**Almost every caller wants `project?.id`.** In `traces-v2` that is what 18 of
the importers use it for; a handful also read `project?.slug` or call
`hasPermission`. They are paying for three tRPC queries, a redirect engine, a
localStorage write and an import of `~/server/api/rbac` — server code inside a
browser hook — to get a string.

Two specific findings worth acting on:

- **The 25 type errors are structural, not incidental.** The hook returns a
  *union of two different shapes*: the early-return at line 661 omits
  `organizations`, `team`, `projectId`, `modelProviders` and `isRefetching`,
  which the success return at 754 has. Every caller destructures across that
  union. Splitting it fixes the errors by construction; patching the types
  without splitting will not hold.
- **`useProjectScope` is the unblocking move, and it is small.** Extracting the
  scope resolution alone — no permissions, no redirects, no model providers —
  releases the majority of the 45 trace and agent-testing importers, and it is
  the thing to do before dispatching a browser wave, not after.

---

## Rules

1. A feature web package declares `@langwatch/platform-api-client` and its own
   contract. Never `@trpc/*`, never `@tanstack/react-query`, never a server
   package.
2. One `createFeatureApi<Map>()` per feature web package, at module scope.
3. The shell mounts the Provider with **its** client and **its** QueryClient.
   The package never builds either.
4. Payload types come from the contract package. `z.input` for procedure inputs
   that have defaults.
5. Add a procedure to the map when a hook needs it. Never speculatively.
6. Internal hooks live under `src/internal/` and are never exported from
   `src/index.ts` or an `exports` entry. Default to internal.
7. An external hook's argument and result types live in the contract package,
   and it returns what the UI renders — not a whole `UseQueryResult`.
8. Use `useUtils()` for procedures the map declares. Use
   `useInvalidateProcedure()` only for ones it does not.
9. Never invent a cache key namespace. If you are writing an array literal into
   a `queryKey`, stop and use `trpcQueryKey`.
10. Hooks return state and callbacks, never JSX. `.ts` for hooks, `.tsx` for
    components (see [react.md](./react.md)).
11. A component that knows what a trace is belongs to Trace. A component that
    knows only Chakra belongs to the design system. A component that needs a
    router belongs to neither until the router is injected.

---

## Follow-ups this pattern creates

- Fix `agent-ui-host.adapter.tsx`'s `["agent-ui", …]` cache namespace. It is a
  live bug, not a style difference.
- Add `@langwatch/platform-api-client` and `@langwatch/trace-web` to the package
  test matrix in `.github/workflows/langwatch-app-ci.yml`. Package suites run
  only if a workflow names them, and neither is named — so the key-encoding test
  above does not run in CI yet.
- Extract `useProjectScope` before the next browser wave.
- Settle the governed-package fork described above.
- Build the map generator when `apps/api` owns the root router, and delete the
  hand-written maps.

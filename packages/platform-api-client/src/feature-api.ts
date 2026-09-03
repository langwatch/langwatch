import type { TRPCUntypedClient } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
  TRPCSubscriptionProcedure,
} from "@trpc/server";

/**
 * One procedure, as a feature web package describes it.
 *
 * A feature package writes a plain nested map of these — no tRPC types — and
 * this package turns the map into a router type. That split is not stylistic:
 * `packages/architecture-lint/oxlint-plugin.mjs` rejects `@trpc/server` from
 * both the `web` and the `contract` role, and the rule fires on the import
 * declaration without checking `importKind`, so `import type` is rejected too.
 * A feature package therefore cannot name `AnyRouter`, `TRPCQueryProcedure` or
 * its own server's router type. This package has no feature role, so it can.
 *
 * A `subscription` names a LIVE procedure — one the platform serves over the
 * SSE lane rather than as a request. Its `output` is the type of ONE entry on
 * that stream, not of the stream: that is what `.subscription(path, input,
 * { onData })` hands the subscriber, one at a time.
 */
export type ProcedureShape =
  | { query: { input: unknown; output: unknown } }
  | { mutation: { input: unknown; output: unknown } }
  | { subscription: { input: unknown; output: unknown } };

/**
 * A feature's procedures, nested exactly as the process's root router mounts
 * them. The nesting is load-bearing: those segments become the tRPC cache key.
 */
export type FeatureApiMap = { [segment: string]: ProcedureShape | FeatureApiMap };

type ProceduresFrom<TMap> = {
  [K in keyof TMap]: TMap[K] extends { query: { input: infer TIn; output: infer TOut } }
    ? TRPCQueryProcedure<{ input: TIn; output: TOut; meta: unknown }>
    : TMap[K] extends { mutation: { input: infer TIn; output: infer TOut } }
      ? TRPCMutationProcedure<{ input: TIn; output: TOut; meta: unknown }>
      : TMap[K] extends { subscription: { input: infer TIn; output: infer TOut } }
        ? TRPCSubscriptionProcedure<{ input: TIn; output: TOut; meta: unknown }>
        : ProceduresFrom<TMap[K]>;
};

/**
 * The root types a feature's router is built on.
 *
 * Only `transformer` is stated, and it has to be. `AnyTRPCRootTypes` leaves it
 * `any`, and tRPC reads that flag to decide whether an output crossed JSON on
 * the way here: with the flag unknown it hands back BOTH answers, so a
 * procedure returning `{ archivedAt: Date | null }` infers as a union with
 * `{ archivedAt: string | null }` and every consumer of a date fails to
 * typecheck against itself. Every client this package builds runs superjson
 * (`apps/ui`'s transport and the application's alike), so a Date really does
 * arrive as a Date and `true` is the honest value.
 */
type FeatureApiRootTypes = Omit<AnyTRPCRootTypes, "transformer"> & { transformer: true };

/** The router type a feature's map describes. */
export type RouterFromMap<TMap> = TRPCBuiltRouter<FeatureApiRootTypes, ProceduresFrom<TMap>>;

/**
 * The feature's typed tRPC hooks.
 *
 * Call this once per feature web package, at module scope:
 *
 *     export const traceApi = createFeatureApi<TraceApiMap>();
 *
 * and then write `traceApi.tracesV2.header.useQuery(input, options)` — the same
 * call the code wrote as `api.tracesV2.header.useQuery(...)` while it lived in
 * the application.
 *
 * WHY SEPARATE INSTANCES ARE SAFE, and this is the whole reason the pattern
 * works: `@trpc/react-query` derives its React Query cache key from the
 * procedure PATH alone. `getQueryKeyInternal` returns
 * `[["tracesV2","header"], { input, type: "query" }]` — no client identity, no
 * provider identity, nothing that distinguishes one `createTRPCReact` instance
 * from another. Given the same QueryClient, a query registered by a feature's
 * hooks and a query registered by the application's `api` proxy are THE SAME
 * CACHE ENTRY. That is what lets hooks move out of the application one file at
 * a time: an un-migrated hook's `utils.tracesV2.header.invalidate()` refetches a
 * migrated hook's query, an un-migrated `setData` seeds it, and a migrated
 * mutation invalidates an un-migrated list — with no coordination between them.
 *
 * It is also the thing to not get wrong. A binding that invents its own key
 * namespace — `["agent-ui", path, input]`, which is what
 * `platform/app/src/runtime/ui/features/agent-ui-host.adapter.tsx` does today —
 * shares no prefix with any tRPC key, so its cache is invisible to every
 * invalidation the rest of the application performs, and vice versa. The
 * symptom is stale UI that looks random.
 *
 * What separate instances DO cost: `useUtils()` is scoped to the feature's own
 * map, so it cannot name another feature's procedures. Use `trpcQueryFilter`
 * for those — deliberately more visible than a typed call, because reaching
 * into another feature's cache should be.
 */
export function createFeatureApi<TMap extends FeatureApiMap>() {
  return createTRPCReact<RouterFromMap<TMap>>();
}

/**
 * The transport a feature's hooks run on.
 *
 * Supplied by the process shell, never constructed in a feature package:
 * building a tRPC client means choosing a base URL, a transformer, a batching
 * window and a WebSocket endpoint, and the base URL is read from the
 * environment — which a reusable package may not do (ADR-101). Sharing the one
 * instance also keeps one HTTP batching lane, so a query fired by an
 * application hook and one fired by a package hook in the same tick still
 * travel in a single request. A second client would quietly split them.
 */
export type FeatureApiClient<TMap extends FeatureApiMap> = TRPCUntypedClient<RouterFromMap<TMap>>;

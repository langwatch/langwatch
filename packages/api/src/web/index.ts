// The browser's half of the transport: the typed tRPC hooks a feature web
// package derives from its own contract, and the cache-key helpers for a
// procedure no contract it can name declares yet. React and
// `@trpc/react-query` live behind this entry and nowhere else in the package.

export {
  createFeatureApi,
  type ContractApiMap,
  // The three tRPC types a derived binding's own declaration names; see
  // feature-api.ts for why they are part of this entry's surface.
  type DecorateRouterRecord,
  type FeatureApi,
  type FeatureApiClient,
  type FeatureApiMap,
  type OutputsFromMap,
  type ProcedureShape,
  type RouterFromMap,
  type UseTRPCMutationResult,
  type UseTRPCQueryResult,
  type WireOf,
} from "./feature-api.ts";
export { trpcQueryFilter, trpcQueryKey, type TrpcQueryKey } from "./trpc-query-key.ts";
export { useInvalidateProcedure } from "./use-invalidate-procedure.ts";

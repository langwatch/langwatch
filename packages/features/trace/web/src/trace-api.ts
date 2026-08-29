import { createFeatureApi } from "@langwatch/platform-api-client";
import type {
  ChangeTraceNameCommand,
  ChangeTraceNameResult,
  TraceHeader,
  TraceHeaderReadInput,
} from "@langwatch/trace-contract";

/**
 * The trace-explorer procedures this package calls, nested exactly as the
 * process's root router mounts them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED. The procedures live in
 * `@langwatch/trace-server`, which a web package may not import — not even for
 * a type (ADR-101, and `oxlint-plugin.mjs` rejects the `@trpc/server` import
 * this would need without exempting `import type`). Even with the lint relaxed
 * there is nothing to import: `TracesV2TrpcApi.create` is generic over the
 * process's context and root, so the router type does not exist until
 * `apps/api` instantiates it. Emitting this file from the mounted router is the
 * fix; writing it by hand is the interim, and it is only honest because the
 * payload types below are the contract's — the same ones the procedure parses
 * and returns.
 *
 * The segment names are load-bearing. `tracesV2` is a mount point on the root
 * router, and tRPC hashes that path into the React Query cache key; spell it
 * differently and these hooks quietly stop sharing a cache with the
 * `api.tracesV2.*` call sites that have not moved yet.
 *
 * `header`'s `full` is optional here and required after parsing. The procedure
 * defaults it to `true`, so the CLIENT-facing input is `z.input` of its schema.
 * `TraceHeaderReadInput` is inferred with `z.input` for that reason.
 *
 * ADD A PROCEDURE when a hook in this package needs it. Do not add one
 * speculatively: every entry is a promise that the router still mounts it under
 * that name, and nothing checks that promise until the generator exists.
 */
export type TraceApiMap = {
  tracesV2: {
    header: { query: { input: TraceHeaderReadInput; output: TraceHeader } };
    changeName: {
      mutation: { input: ChangeTraceNameCommand; output: ChangeTraceNameResult };
    };
  };
};

/**
 * Trace's typed tRPC hooks. Same machinery, same transport and same React Query
 * cache as the application's `api` proxy — see `createFeatureApi` for why
 * separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and other
 * packages call the hooks. It is exported from `src/index.ts` only so the
 * process shell can mount `traceApi.Provider`.
 */
export const traceApi = createFeatureApi<TraceApiMap>();

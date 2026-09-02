/**
 * The transport the Optimization Studio's call sites already wrote.
 *
 * Every module that moved out of `platform/app` with the studio wrote
 * `api.workflow.getById.useQuery(...)`, and the point of this file is that it
 * still can. `api` here is the family's own `createFeatureApi` client — the
 * same machinery, the same tRPC links and the same React Query cache the
 * application's `api` proxy uses, because tRPC derives its cache key from the
 * procedure PATH alone. A studio query and the same query fired from a page
 * this application still serves are one cache entry.
 *
 * `RouterInputs` and `RouterOutputs` are derived from the map STRUCTURALLY
 * rather than through `inferRouterInputs<AppRouter>`: `AppRouter` lives in the
 * application's server and neither `@trpc/server` nor a server package may be
 * named from a feature-web package. The two helpers below read the same map the
 * hooks are built from, so `RouterOutputs["prompts"]["getByIdOrHandle"]` keeps
 * meaning what it meant.
 */

import type { RouterFromMap } from "@langwatch/platform-api-client";

import { workflowApi, type WorkflowApiMap } from "../workflow-api";

export const api = workflowApi;

/** What each procedure in the map takes. */
export type RouterInputs = {
  [K in keyof WorkflowApiMap]: InputsOf<WorkflowApiMap[K]>;
};

/** What each procedure in the map answers. */
export type RouterOutputs = {
  [K in keyof WorkflowApiMap]: OutputsOf<WorkflowApiMap[K]>;
};

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

type OutputsOf<TNode> = TNode extends { query: { output: infer TOut } }
  ? TOut
  : TNode extends { mutation: { output: infer TOut } }
    ? TOut
    : TNode extends { subscription: { output: infer TOut } }
      ? TOut
      : { [K in keyof TNode]: OutputsOf<TNode[K]> };

/**
 * The name the moved call sites used for the application's root router.
 *
 * They used it two ways — `inferRouterOutputs<AppRouter>["x"]["y"]` and
 * `TRPCClientErrorLike<AppRouter>` — and both want a real tRPC router type,
 * which is what `RouterFromMap` builds out of the map above without this
 * package naming `@trpc/server`. It is NOT the application's whole router: it
 * is the studio's slice of it, which is every procedure the studio calls.
 */
export type AppRouter = RouterFromMap<WorkflowApiMap>;

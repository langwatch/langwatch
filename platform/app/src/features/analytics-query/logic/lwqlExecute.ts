/**
 * How a submission reaches the LangWatchQL endpoint.
 *
 * The vanilla tRPC client rather than `useMutation`, for one reason: the
 * request has to be abortable. Leaving the workbench mid-query must cancel the
 * HTTP request, not merely ignore its answer, and the mutation hook exposes no
 * signal. This is the same seam and the same unwrapping `spanTreePagedQuery`
 * uses for the span tree.
 *
 * @see ~/features/traces-v2/hooks/spanTreePagedQuery — the pattern this follows
 */

import { getUntypedClient } from "@trpc/client";

import type { LangWatchQLQueryResult } from "~/server/analytics/lwql";
import type { api, RouterInputs } from "~/utils/api";

import type { LangWatchQLExecute } from "./lwqlRequestController";
import type { LangWatchQLParameterValue } from "./lwqlRequestState";

type TrpcUtils = ReturnType<typeof api.useUtils>;

/** Dotted path, because the call is made through the untyped client. */
const LWQL_QUERY_PATH = "analytics.lwql.query";

/**
 * The input the pinned call signature below declares.
 *
 * Written out rather than inferred because the dotted-path call defeats
 * inference (see {@link createLangWatchQLExecute}). Naming it is what lets the
 * assertion underneath tie it back to the procedure's own schema.
 */
type LangWatchQLQueryInput = {
  projectId: string;
  sql: string;
  parameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  timeWindow?: { start: Date; end: Date };
};

/**
 * Binds the hand-written shape to the router's schema at compile time.
 *
 * Pinning the signature is unavoidable, but drifting from the procedure is
 * not: if `analytics.lwql.query` gains, drops or retypes a field, the
 * constraint below stops being satisfied and this file fails to compile
 * instead of failing at runtime.
 */
type AssignableToQueryInput<T extends RouterInputs["analytics"]["lwql"]["query"]> = T;
type _LangWatchQLQueryInputMatchesRouter = AssignableToQueryInput<LangWatchQLQueryInput>;

/**
 * Binds an executor to one project.
 *
 * The signature is pinned rather than inferred: `utils.client` is a
 * `createTRPCClientProxy` wrapper, so `mutation` resolves through the prototype
 * chain and neither the proxy's own generics nor `RouterOutputs` type a
 * dotted-path call. {@link LangWatchQLQueryResult} is the service's own return
 * type, which is what the procedure returns.
 */
export function createLangWatchQLExecute({
  utils,
  projectId,
}: {
  utils: TrpcUtils;
  projectId: string;
}): LangWatchQLExecute {
  // `utils.client` is the proxy, not the client — `getUntypedClient` unwraps it
  // so `mutation` is the real method and can be bound. Binding the proxy
  // instead yields a function that throws on call.
  const client = getUntypedClient(
    utils.client as unknown as Parameters<typeof getUntypedClient>[0],
  );
  const mutate = client.mutation.bind(client) as (
    path: typeof LWQL_QUERY_PATH,
    input: LangWatchQLQueryInput,
    options?: { signal?: AbortSignal },
  ) => Promise<LangWatchQLQueryResult>;

  return ({ timeWindow, ...request }, { signal }) =>
    mutate(
      LWQL_QUERY_PATH,
      {
        ...request,
        // Instants on the wire, milliseconds in the draft: the draft compares
        // snapshots by value, and the endpoint reads a window. Converting here
        // keeps each side holding the shape it needs rather than the other's.
        ...(timeWindow
          ? {
              timeWindow: {
                start: new Date(timeWindow.start),
                end: new Date(timeWindow.end),
              },
            }
          : {}),
        // `projectId` goes last so the bound project wins: spreading it first
        // let any `projectId` carried on the request override the project this
        // executor is bound to, which is the one thing the binding prevents.
        projectId,
      },
      { signal },
    );
}

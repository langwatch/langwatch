/**
 * How a submission reaches the governed SQL endpoint.
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

import type { GovernedSqlQueryResult } from "~/server/analytics/governed-sql";
import type { api } from "~/utils/api";

import type { GovernedSqlExecute } from "./governedSqlRequestController";
import type { GovernedSqlParameterValue } from "./governedSqlRequestState";

type TrpcUtils = ReturnType<typeof api.useUtils>;

/** Dotted path, because the call is made through the untyped client. */
const GOVERNED_SQL_QUERY_PATH = "analytics.governedSql.query";

/**
 * Binds an executor to one project.
 *
 * The signature is pinned rather than inferred: `utils.client` is a
 * `createTRPCClientProxy` wrapper, so `mutation` resolves through the prototype
 * chain and neither the proxy's own generics nor `RouterOutputs` type a
 * dotted-path call. {@link GovernedSqlQueryResult} is the service's own return
 * type, which is what the procedure returns.
 */
export function createGovernedSqlExecute({
  utils,
  projectId,
}: {
  utils: TrpcUtils;
  projectId: string;
}): GovernedSqlExecute {
  // `utils.client` is the proxy, not the client — `getUntypedClient` unwraps it
  // so `mutation` is the real method and can be bound. Binding the proxy
  // instead yields a function that throws on call.
  const client = getUntypedClient(
    utils.client as unknown as Parameters<typeof getUntypedClient>[0],
  );
  const mutate = client.mutation.bind(client) as (
    path: typeof GOVERNED_SQL_QUERY_PATH,
    input: {
      projectId: string;
      sql: string;
      parameters?: Readonly<Record<string, GovernedSqlParameterValue>>;
    },
    options?: { signal?: AbortSignal },
  ) => Promise<GovernedSqlQueryResult>;

  return (request, { signal }) =>
    mutate(GOVERNED_SQL_QUERY_PATH, { projectId, ...request }, { signal });
}

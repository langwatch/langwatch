/**
 * The event-log search as the explorer drives it (ADR-202 Decided 14): a submitted search goes to
 * a worker, and its result is read by request id and refetched on the completion's read hint.
 * No timer polls. Spec: modules/ops/specs/event-log-search.feature
 */
import { useEffect, useRef, useState } from "react";

import { api } from "../../../behavior/ops-api.ts";
import { useOperatorReadHints } from "../../../behavior/use-operator-read-hints.ts";
import type { AggregateResult } from "../model/deja-view-types.ts";

export type AggregateSearchState = {
  results: AggregateResult[] | undefined;
  isSearching: boolean;
  error: unknown;
  /** The worker could not run it, or it outlived its 10 minutes: search again. */
  outcome: "failed" | "expired" | undefined;
};

export function useAggregateSearch({
  query,
  tenantId,
  enabled,
}: {
  query: string;
  tenantId: string | undefined;
  enabled: boolean;
}): AggregateSearchState {
  useOperatorReadHints({ path: "ops.getAggregateSearch" });
  const request = api.ops.searchAggregates.useMutation();
  const { mutate } = request;
  const [requestId, setRequestId] = useState<string | undefined>(void 0);
  const sent = useRef<string | undefined>(void 0);
  const searchKey = enabled ? JSON.stringify([query, tenantId ?? ""]) : void 0;

  useEffect(() => {
    if (searchKey === void 0 || searchKey === sent.current) return;
    sent.current = searchKey;
    setRequestId(void 0);
    mutate({ query, tenantId }, { onSuccess: (accepted) => setRequestId(accepted.requestId) });
  }, [searchKey, query, tenantId, mutate]);

  const answer = api.ops.getAggregateSearch.useQuery(
    { requestId: requestId ?? "" },
    { enabled: requestId !== void 0 },
  );
  const data = answer.data;

  return {
    results: data?.status === "done" ? data.results : void 0,
    isSearching:
      request.isPending || (requestId !== void 0 && (data === void 0 || data.status === "pending")),
    error: request.error ?? answer.error ?? void 0,
    outcome: data?.status === "failed" || data?.status === "expired" ? data.status : void 0,
  };
}

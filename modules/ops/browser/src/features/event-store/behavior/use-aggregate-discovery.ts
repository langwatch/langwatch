/**
 * The replay wizard's aggregate count (ADR-202 Decided 14): a changed scope goes to a worker, and
 * its counts are read by request id and refetched on the completion's read hint. No timer polls.
 * Spec: modules/ops/specs/event-log-search.feature
 */
import type { AggregateDiscovery } from "@langwatch/ops-contract";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../behavior/ops-api.ts";
import { useOperatorReadHints } from "../../../behavior/use-operator-read-hints.ts";

export type AggregateDiscoveryState = {
  discovery: AggregateDiscovery | undefined;
  isDiscovering: boolean;
  error: unknown;
  /** The worker could not count, or the count outlived its 10 minutes: change the scope again. */
  outcome: "failed" | "expired" | undefined;
};

/** Counts once per tenant scope and date, then hands the projections with data on. */
export function useAggregateDiscovery({
  projectionNames,
  since,
  tenantIds,
  enabled,
  onDiscovered,
}: {
  projectionNames: string[];
  since: string;
  tenantIds: string[];
  enabled: boolean;
  onDiscovered: (projectionNames: Set<string>) => void;
}): AggregateDiscoveryState {
  useOperatorReadHints({ path: "ops.getAggregateDiscovery" });
  const request = api.ops.discoverAggregates.useMutation();
  const { mutate } = request;
  const [requestId, setRequestId] = useState<string | undefined>(void 0);
  const sent = useRef<string | undefined>(void 0);
  const announced = useRef<string | undefined>(void 0);
  const scopeKey = enabled ? JSON.stringify({ tenantIds, since }) : void 0;

  useEffect(() => {
    if (scopeKey === void 0 || scopeKey === sent.current) return;
    sent.current = scopeKey;
    setRequestId(void 0);
    mutate(
      { projectionNames, since, tenantIds },
      { onSuccess: (accepted) => setRequestId(accepted.requestId) },
    );
  }, [scopeKey, projectionNames, since, tenantIds, mutate]);

  const answer = api.ops.getAggregateDiscovery.useQuery(
    { requestId: requestId ?? "" },
    { enabled: requestId !== void 0 },
  );
  const data = answer.data;
  const discovery = data?.status === "done" ? data.discovery : void 0;

  useEffect(() => {
    if (discovery === void 0 || requestId === void 0 || announced.current === requestId) return;
    announced.current = requestId;
    onDiscovered(
      new Set(
        discovery.projections.filter((p) => p.aggregateCount > 0).map((p) => p.projectionName),
      ),
    );
  }, [discovery, requestId, onDiscovered]);

  return {
    discovery,
    isDiscovering:
      request.isPending || (requestId !== void 0 && (data === void 0 || data.status === "pending")),
    error: request.error ?? answer.error ?? void 0,
    outcome: data?.status === "failed" || data?.status === "expired" ? data.status : void 0,
  };
}

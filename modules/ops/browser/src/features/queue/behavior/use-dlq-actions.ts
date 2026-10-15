import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../../behavior/ops-api.ts";
import { useOpsMutationOutcomes } from "../../../behavior/ops-mutation-outcome.ts";
/** What a pending bulk or single act covers — named fully in the confirm. */
export interface PendingDlqAction {
  kind: "redrive" | "discard";
  queueName: string;
  queueDisplayName: string;
  groupIds: string[];
}

const plural = (count: number) => (count === 1 ? "group" : "groups");

/** The explicit-id endpoints accept at most this many ids per call. */
const MAX_GROUP_IDS_PER_CALL = 2000;

/**
 * Sends the ids in sequential batches the endpoint accepts and sums each
 * count, so one act covers every group the operator saw.
 */
async function inBatches<T extends Record<string, number>>(
  input: { queueName: string; groupIds: string[] },
  send: (batch: { queueName: string; groupIds: string[] }) => Promise<T>,
): Promise<T> {
  const totals: Record<string, number> = {};
  for (let i = 0; i < input.groupIds.length; i += MAX_GROUP_IDS_PER_CALL) {
    const result = await send({
      queueName: input.queueName,
      groupIds: input.groupIds.slice(i, i + MAX_GROUP_IDS_PER_CALL),
    });
    for (const [key, value] of Object.entries(result)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals as T;
}

/**
 * The DLQ card's recovery mutations (specs/ops/dead-letter-recovery.feature).
 * Both the row action and the per-queue bulk go through the explicit-id
 * endpoints, so the confirmation covers exactly the ids the operator saw.
 */
export function useDlqActions() {
  const { countOutcomeHandlers } = useOpsMutationOutcomes();
  const utils = api.useUtils();
  const [pending, setPending] = useState<PendingDlqAction | null>(null);
  const [canaryTarget, setCanaryTarget] = useState<string | null>(null);

  const settle = () => {
    setPending(null);
    setCanaryTarget(null);
    void utils.ops.invalidate();
  };

  const redrive = useMutation({
    mutationFn: (input: { queueName: string; groupIds: string[] }) =>
      inBatches(input, (batch) => utils.client.ops.redriveManyFromDlq.mutate(batch)),
    ...countOutcomeHandlers({
      onSettled: settle,
      title: (n) => `Redrove ${n} ${plural(n)}`,
      failure: "Couldn't redrive the groups",
    }),
  });
  const discard = useMutation({
    mutationFn: (input: { queueName: string; groupIds: string[] }) =>
      inBatches(input, (batch) => utils.client.ops.discardManyFromDlq.mutate(batch)),
    ...countOutcomeHandlers({
      onSettled: settle,
      title: (n) => `Discarded ${n} ${plural(n)}`,
      failure: "Couldn't discard the groups",
    }),
  });
  const canaryRedrive = api.ops.canaryRedrive.useMutation(
    countOutcomeHandlers({
      onSettled: settle,
      title: (n) => `Canary redrove ${n} ${plural(n)}`,
      failure: "Couldn't run the canary redrive",
    }),
  );

  return {
    pending,
    setPending,
    canaryTarget,
    setCanaryTarget,
    redrive,
    discard,
    canaryRedrive,
    confirmPending: () => {
      if (!pending) return;
      const input = {
        queueName: pending.queueName,
        groupIds: pending.groupIds,
      };
      if (pending.kind === "redrive") redrive.mutate(input);
      else discard.mutate(input);
    },
  };
}

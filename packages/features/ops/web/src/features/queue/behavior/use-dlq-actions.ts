import { useState } from "react";
import { api } from "../../../behavior/ops-api";

import { useOpsMutationOutcomes } from "../../../behavior/ops-mutation-outcome";
/** What a pending bulk or single act covers — named fully in the confirm. */
export interface PendingDlqAction {
  kind: "redrive" | "discard";
  queueName: string;
  queueDisplayName: string;
  groupIds: string[];
}

const plural = (count: number) => (count === 1 ? "group" : "groups");

/**
 * The DLQ card's recovery mutations (specs/ops/dead-letter-recovery.feature).
 *
 * Both the row action and the per-queue bulk go through the explicit-id
 * endpoints: one verb, one audit shape, and the confirmation covers exactly
 * the ids that were shown when the operator clicked.
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

  const redrive = api.ops.redriveManyFromDlq.useMutation(
    countOutcomeHandlers({
      onSettled: settle,
      title: (n) => `Redrove ${n} ${plural(n)}`,
      failure: "Couldn't redrive the groups",
    }),
  );
  const discard = api.ops.discardManyFromDlq.useMutation(
    countOutcomeHandlers({
      onSettled: settle,
      title: (n) => `Discarded ${n} ${plural(n)}`,
      failure: "Couldn't discard the groups",
    }),
  );
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

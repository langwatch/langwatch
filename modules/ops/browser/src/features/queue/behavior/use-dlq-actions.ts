import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../../../behavior/ops-api.ts";
import { useShowErrorToast } from "../../../behavior/ops-feedback.ts";
import { useOpsMutationOutcomes } from "../../../behavior/ops-mutation-outcome.ts";
import { inBatches, PartialBatchError } from "../model/dlq-batches.ts";
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
 * Both the row action and the per-queue bulk go through the explicit-id
 * endpoints, so the confirmation covers exactly the ids the operator saw.
 */
export function useDlqActions() {
  const { countOutcomeHandlers } = useOpsMutationOutcomes();
  const showErrorToast = useShowErrorToast();
  const utils = api.useUtils();
  const [pending, setPending] = useState<PendingDlqAction | null>(null);
  const [canaryTarget, setCanaryTarget] = useState<string | null>(null);

  const settle = () => {
    setPending(null);
    setCanaryTarget(null);
    void utils.ops.invalidate();
  };

  /** A batch failing after others applied names what did apply; the rest stay in the DLQ. */
  const showPartialOrError = (error: unknown, failure: string, applied: (n: number) => string) => {
    if (!(error instanceof PartialBatchError)) {
      showErrorToast({ error, fallbackTitle: failure });
      return;
    }
    const groups = Object.values(error.done)[0] ?? 0;
    showErrorToast({
      error: error.cause,
      title: `${applied(groups)}, then failed; the rest are still in the DLQ`,
    });
  };

  /** A redrive or discard over any number of ids, sent in batches the endpoint accepts. */
  const batched = <T extends Record<string, number>>(
    send: (batch: { queueName: string; groupIds: string[] }) => Promise<T>,
    title: (count: number) => string,
    failure: string,
  ) => ({
    mutationFn: (input: { queueName: string; groupIds: string[] }) => inBatches(input, send),
    ...countOutcomeHandlers({ onSettled: settle, title, failure }),
    onError: (error: unknown) => showPartialOrError(error, failure, title),
  });

  const redrive = useMutation(
    batched(
      (batch) => utils.client.ops.redriveManyFromDlq.mutate(batch),
      (n) => `Redrove ${n} ${plural(n)}`,
      "Couldn't redrive the groups",
    ),
  );
  const discard = useMutation(
    batched(
      (batch) => utils.client.ops.discardManyFromDlq.mutate(batch),
      (n) => `Discarded ${n} ${plural(n)}`,
      "Couldn't discard the groups",
    ),
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
      // An empty set sends nothing, so it must not report a success either.
      if (!pending || pending.groupIds.length === 0) return;
      const input = {
        queueName: pending.queueName,
        groupIds: pending.groupIds,
      };
      if (pending.kind === "redrive") redrive.mutate(input);
      else discard.mutate(input);
    },
  };
}

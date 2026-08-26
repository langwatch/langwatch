import { useState } from "react";
import {
  countOutcomeHandlers,
  mutationOutcomeHandlers,
} from "~/components/ops/shared/mutationOutcome";
import { api } from "~/utils/api";
import type { DeadLetterMessage } from "@langwatch/ops-web";

/** Which bulk act is awaiting confirmation, if any. */
export type BulkDeadLetterAction = "redrive" | "discard" | null;

const plural = (count: number) => (count === 1 ? "message" : "messages");

const refOf = (message: DeadLetterMessage) => ({
  processName: message.processName,
  projectId: message.projectId,
  processKey: message.processKey,
  messageId: message.id,
});

/** Redrive or discard one dead letter from its row. */
function useRowActions(onSettled: () => void) {
  const [redrivingId, setRedrivingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<DeadLetterMessage | null>(null);
  const settle = () => {
    setRedrivingId(null);
    setDiscardingId(null);
    setDiscardTarget(null);
    onSettled();
  };

  const redrive = api.ops.processRedriveDeadMessage.useMutation(
    mutationOutcomeHandlers({
      onSettled: settle,
      applied: "Message redriven",
      missed: "Message is no longer dead",
      failure: "Couldn't redrive the message",
    }),
  );
  const discard = api.ops.processDiscardDeadMessage.useMutation(
    mutationOutcomeHandlers({
      onSettled: settle,
      applied: "Message discarded",
      missed: "Message is no longer dead",
      failure: "Couldn't discard the message",
    }),
  );

  return {
    redrivingId,
    discardingId,
    discardTarget,
    setDiscardTarget,
    onRedrive: (message: DeadLetterMessage) => {
      setRedrivingId(message.id);
      redrive.mutate(refOf(message));
    },
    /** Asks first: nothing un-discards a message. */
    onDiscard: (message: DeadLetterMessage) => setDiscardTarget(message),
    confirmDiscard: () => {
      if (!discardTarget) return;
      setDiscardingId(discardTarget.id);
      discard.mutate(refOf(discardTarget));
    },
  };
}

/** Redrive or discard everything the current filter shows. */
function useBulkActions(onSettled: () => void) {
  const [confirmBulk, setConfirmBulk] = useState<BulkDeadLetterAction>(null);
  const settle = () => {
    setConfirmBulk(null);
    onSettled();
  };

  const redriveAll = api.ops.redriveDeadLetters.useMutation(
    countOutcomeHandlers({
      onSettled: settle,
      title: (n) => `Redrove ${n} ${plural(n)}`,
      failure: "Couldn't redrive the messages",
    }),
  );
  const discardAll = api.ops.discardDeadLetters.useMutation(
    countOutcomeHandlers({
      onSettled: settle,
      title: (n) => `Discarded ${n} ${plural(n)}`,
      failure: "Couldn't discard the messages",
    }),
  );

  return { confirmBulk, setConfirmBulk, redriveAll, discardAll };
}

/**
 * The Dead Letters page's mutations and their pending state
 * (specs/ops/dead-letter-recovery.feature). Returns state and callbacks only,
 * never JSX — same shape as `useProcessInstanceActions`, which owns the
 * equivalent set for one process instance.
 */
export function useDeadLetterActions() {
  const utils = api.useUtils();
  const invalidate = () => void utils.ops.invalidate();
  return {
    ...useRowActions(invalidate),
    ...useBulkActions(invalidate),
  };
}

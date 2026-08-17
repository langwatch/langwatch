import { useState } from "react";
import {
  countOutcomeHandlers,
  mutationOutcomeHandlers,
} from "~/components/ops/shared/mutationOutcome";
import { api } from "~/utils/api";
import type { DeadLetterMessage } from "./DeadLettersCard";

/** Which bulk act is awaiting confirmation, if any. */
export type BulkDeadLetterAction = "redrive" | "discard" | null;

const plural = (count: number) => (count === 1 ? "message" : "messages");

/**
 * The Dead Letters page's four mutations and their pending state
 * (specs/ops/dead-letter-recovery.feature). Returns state and callbacks only,
 * never JSX — same shape as `useProcessInstanceActions`, which owns the
 * equivalent set for one process instance.
 */
export function useDeadLetterActions() {
  const utils = api.useUtils();
  const [redrivingId, setRedrivingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<BulkDeadLetterAction>(null);

  const settle = () => {
    setRedrivingId(null);
    setDiscardingId(null);
    setConfirmBulk(null);
    void utils.ops.invalidate();
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

  const refOf = (message: DeadLetterMessage) => ({
    processName: message.processName,
    projectId: message.projectId,
    processKey: message.processKey,
    messageId: message.id,
  });

  return {
    redrivingId,
    discardingId,
    confirmBulk,
    setConfirmBulk,
    redriveAll,
    discardAll,
    onRedrive: (message: DeadLetterMessage) => {
      setRedrivingId(message.id);
      redrive.mutate(refOf(message));
    },
    onDiscard: (message: DeadLetterMessage) => {
      setDiscardingId(message.id);
      discard.mutate(refOf(message));
    },
  };
}

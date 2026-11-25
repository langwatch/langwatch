import {
  compareLangyEventCursors,
  LANGY_CONVERSATION_TURN_STATUS,
  type LangyEventCursor,
} from "@langwatch/langy-contract";

/** The turn a live error interrupted, as it stood when the error arrived. */
export interface InterruptedTurn {
  turnId: string;
  /** The record already called it complete, so the error was about a later send. */
  completedAlready: boolean;
}

/** The durable record's word on the current turn. */
export interface RecordedTurn {
  turnId: string | null;
  status: string | null;
  cursor: LangyEventCursor | null;
}

/**
 * A live turn error the record contradicts: the stream broke but its turn completed. Cleared only
 * once the transcript read reaches that completion, so the recorded answer replaces the cut-off
 * one. Spec: specs/langy/langy-turn-recovery.feature
 */
export function isTurnErrorOutlived({
  interrupted,
  recorded,
  transcriptCursor,
}: {
  interrupted: InterruptedTurn | null;
  recorded: RecordedTurn;
  transcriptCursor: LangyEventCursor | null;
}): boolean {
  if (!interrupted || interrupted.completedAlready) return false;
  if (recorded.turnId !== interrupted.turnId) return false;
  if (recorded.status !== LANGY_CONVERSATION_TURN_STATUS.COMPLETED) return false;
  if (!transcriptCursor || !recorded.cursor) return false;

  return compareLangyEventCursors(transcriptCursor, recorded.cursor) >= 0;
}

/**
 * A live error nothing could name, on a turn the record holds as running (or saw complete before
 * the transcript caught up): the connection broke, not the turn, and "Try again" would start a
 * second one. Spec: specs/langy/langy-turn-recovery.feature
 */
export function isLiveErrorOnRunningTurn({
  errorCode,
  interrupted,
  turnInFlight,
  recorded,
}: {
  errorCode: string;
  interrupted: InterruptedTurn | null;
  /** This tab still holds the interrupted turn as in flight. */
  turnInFlight: boolean;
  recorded: Pick<RecordedTurn, "turnId" | "status">;
}): boolean {
  if (errorCode !== "unknown") return false;
  if (!interrupted || interrupted.completedAlready) return false;
  const recordedStatus = recorded.turnId === interrupted.turnId ? recorded.status : null;
  if (
    recordedStatus === LANGY_CONVERSATION_TURN_STATUS.FAILED ||
    recordedStatus === LANGY_CONVERSATION_TURN_STATUS.STOPPED
  ) {
    return false;
  }
  return turnInFlight || recordedStatus === LANGY_CONVERSATION_TURN_STATUS.COMPLETED;
}

import {
  LANGY_CONVERSATION_STATUS,
  LangyAgentUnavailableError,
  LangyModelNotAllowedError,
  LangyTurnInProgressError,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:langy:turn-start");

type AdmissionTurn = {
  projectId: string;
  conversation: { id: string };
  turnId: string;
  turnModel: string;
};

/**
 * Admits a turn only when it can be signed, its model is allowed and the
 * conversation is not already running; answers the run token to sign with.
 */
export function requireRunnableTurn({
  turn,
  current,
  runToken,
  modelsAllowed,
}: {
  turn: AdmissionTurn;
  current: PromiseSettledResult<{ status: string } | null>;
  runToken: PromiseSettledResult<string | null>;
  modelsAllowed: PromiseSettledResult<readonly string[] | null>;
}): string {
  if (runToken.status === "rejected" || !runToken.value) {
    logger.error(
      {
        error: runToken.status === "rejected" ? runToken.reason : undefined,
        projectId: turn.projectId,
        conversationId: turn.conversation.id,
        turnId: turn.turnId,
      },
      "could not read langy runToken; refusing unsignable turn",
    );
    throw new LangyAgentUnavailableError("Agent request failed");
  }

  if (modelsAllowed.status === "rejected") throw modelsAllowed.reason;

  if (modelsAllowed.value && !modelsAllowed.value.includes(turn.turnModel)) {
    logger.warn(
      {
        projectId: turn.projectId,
        turnModel: turn.turnModel,
        allowedCount: modelsAllowed.value.length,
      },
      "turn model not allowed",
    );
    throw new LangyModelNotAllowedError(turn.turnModel);
  }

  if (current.status === "rejected") {
    logger.warn(
      { error: current.reason, conversationId: turn.conversation.id },
      "busy projection read failed after admission",
    );
  }

  if (
    current.status === "fulfilled" &&
    current.value?.status === LANGY_CONVERSATION_STATUS.RUNNING
  ) {
    throw new LangyTurnInProgressError();
  }

  return runToken.value;
}

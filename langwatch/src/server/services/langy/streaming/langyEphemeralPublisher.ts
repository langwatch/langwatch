/**
 * Redis implementation of the `LangyEphemeralPublisher` seam (ADR-044).
 *
 * This is the live transport: ephemeral status/progress signals are written to the
 * per-turn Redis stream (the same stream the token deltas ride), never to the
 * event log. A signal without a `turnId` cannot be placed on a turn stream, so
 * it is dropped — ephemeral signals are best-effort by definition, and the PR3
 * worker always carries the turnId.
 *
 * The durable/ephemeral split (per the design refinement): "major update"
 * (which tool/action the agent is picking) and "sub update" (how far through a
 * subtask) are ephemeral status/progress signals handled here; anything the
 * agent produces that is worth persisting is a DURABLE milestone event
 * dispatched through the pipeline, not published here.
 */

import { createLogger } from "~/utils/logger/server";
import type {
  LangyEphemeralPublisher,
  LangyEphemeralSignal,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/ephemeral";
import { LANGY_EPHEMERAL_SIGNAL_TYPES } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyTokenBuffer } from "./langyTokenBuffer";

const logger = createLogger("langwatch:langy:ephemeral-publisher");

export class RedisLangyEphemeralPublisher implements LangyEphemeralPublisher {
  constructor(private readonly buffer: LangyTokenBuffer) {}

  async publish(
    _tenantId: string,
    signal: LangyEphemeralSignal,
  ): Promise<void> {
    const { conversationId, turnId } = signal;
    if (!turnId) {
      // No turn stream to place it on. Ephemeral signals are non-durable, so
      // dropping is correct (not data loss) — the worker always has a turnId.
      logger.debug(
        { conversationId, type: signal.type },
        "dropping ephemeral signal without turnId",
      );
      return;
    }

    try {
      if (signal.type === LANGY_EPHEMERAL_SIGNAL_TYPES.STATUS_REPORTED) {
        await this.buffer.appendStatus({
          conversationId,
          turnId,
          status: signal.status,
        });
        return;
      }
      if (signal.type === LANGY_EPHEMERAL_SIGNAL_TYPES.PROGRESS_REPORTED) {
        await this.buffer.appendProgress({
          conversationId,
          turnId,
          message: signal.message,
          progress: signal.progress,
        });
      }
    } catch (error) {
      // A dropped tick must never fail the turn — the live edge is best-effort.
      logger.warn(
        { error, conversationId, turnId, type: signal.type },
        "failed to publish ephemeral signal",
      );
    }
  }
}

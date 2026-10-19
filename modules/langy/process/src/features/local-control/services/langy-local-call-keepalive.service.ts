import { HandledError } from "@langwatch/handled-error";
import { LIVE_STREAM_KEEPALIVE_MS } from "@langwatch/langy-contract";

import type { LangyLocalCallRepository } from "../../../repositories/langy-local-call.repository.ts";
import type { LangyLocalPresenceRepository } from "../../../repositories/langy-local-presence.repository.ts";
import { callActivityLine } from "../../../rules/langy-local-call-activity.rules.ts";
import type {
  LocalCallBuffer,
  StoredLocalCall,
} from "../../../rules/langy-local-call-record.rules.ts";
import { LANGY_LIVENESS } from "../../../rules/langy-streaming-constants.rules.ts";

interface LocalCallKeepaliveOptions {
  calls: Pick<LangyLocalCallRepository, "claimKeepaliveWindow">;
  presence: Pick<LangyLocalPresenceRepository, "getByConversationId">;
  /** Absent where no turn buffer was composed: polling then keeps nothing alive. */
  buffer: LocalCallBuffer | null;
  now: () => number;
}

/** Keeps a polled call's turn alive and its activity line on the panel (ADR-129 "Transport"). */
export class LocalCallKeepaliveService {
  static create(options: LocalCallKeepaliveOptions): LocalCallKeepaliveService {
    return new LocalCallKeepaliveService(options);
  }

  private constructor(private readonly options: LocalCallKeepaliveOptions) {}

  /**
   * The keepalive gate of one poll request: it refreshes on the first pass,
   * then once per heartbeat interval for as long as the request holds.
   */
  beater(): (call: StoredLocalCall) => Promise<void> {
    let lastBeatAt: number | null = null;

    return async (call) => {
      const now = this.options.now();
      const due = lastBeatAt === null || now - lastBeatAt >= LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS;
      if (!due) {
        return;
      }

      lastBeatAt = now;
      await this.keepTurnAlive(call);
    };
  }

  /**
   * Holds the turn open, and says on the panel what the machine is doing, at
   * most once per window. Gated on its own key, not the call record — two
   * replicas polling one call must not each write a line.
   */
  private async keepTurnAlive(call: StoredLocalCall): Promise<void> {
    const buffer = this.options.buffer;
    if (!buffer) {
      return;
    }

    await buffer.heartbeat({
      conversationId: call.conversationId,
      turnId: call.turnId,
      now: this.options.now(),
    });
    if (this.options.now() - call.createdAt < LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS) {
      return;
    }

    const firstOfWindow = await this.options.calls.claimKeepaliveWindow({
      callId: call.callId,
      at: this.options.now(),
      ttlSeconds: Math.ceil(LIVE_STREAM_KEEPALIVE_MS / 1000),
    });
    if (!firstOfWindow) {
      return;
    }

    const workspace = await this.options.presence
      .getByConversationId(call.conversationId)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
          return null;
        }
        throw error;
      });
    await buffer.appendStatus({
      conversationId: call.conversationId,
      turnId: call.turnId,
      status: callActivityLine({
        call,
        machine: workspace?.hostname ?? "your machine",
      }),
    });
  }
}

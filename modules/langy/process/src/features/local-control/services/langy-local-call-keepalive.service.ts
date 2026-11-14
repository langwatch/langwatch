import { setTimeout as sleep } from "node:timers/promises";

import { HandledError } from "@langwatch/handled-error";
import { LIVE_STREAM_KEEPALIVE_MS } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type { LangyLocalCallRepository } from "../../../repositories/langy-local-call.repository.ts";
import type { LangyLocalPresenceRepository } from "../../../repositories/langy-local-presence.repository.ts";
import { callActivityLine } from "../../../rules/langy-local-call-activity.rules.ts";
import type {
  LocalCallBuffer,
  StoredLocalCall,
} from "../../../rules/langy-local-call-record.rules.ts";
import { LANGY_LIVENESS } from "../../../rules/langy-streaming-constants.rules.ts";
import type { LangyActorUserReader } from "../../../services/langy-actor-session.service.ts";

const logger = createLogger("langwatch:langy:local-control:keepalive");

/** How long the line waits for the person's name before it names the machine instead. */
const NAME_LOOKUP_MS = 1_000;

interface LocalCallKeepaliveOptions {
  calls: Pick<LangyLocalCallRepository, "claimKeepaliveWindow">;
  presence: Pick<LangyLocalPresenceRepository, "getByConversationId">;
  /** Absent where no turn buffer was composed: polling then keeps nothing alive. */
  buffer: LocalCallBuffer | null;
  /** Names the person whose machine it is; absent, the line names the machine instead. */
  users?: LangyActorUserReader;
  now: () => number;
  /** Test knob: how long the name lookup may hold the poll. */
  nameLookupMs?: number;
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
        personName: workspace ? await this.personName(workspace.userId) : null,
        hostname: workspace?.hostname ?? null,
      }),
    });
  }

  /**
   * A name that fails, or is slow to come, costs the line its name, never the poll:
   * the lookup is raced against a short deadline.
   */
  private async personName(userId: string): Promise<string | null> {
    const users = this.options.users;
    if (!users) {
      return null;
    }
    const lookup = users.findById({ id: userId }).catch((error: unknown) => {
      logger.warn({ error, userId }, "could not read the name for the activity line");
      return null;
    });
    const deadline = new AbortController();
    const timeout = sleep(this.options.nameLookupMs ?? NAME_LOOKUP_MS, null, {
      signal: deadline.signal,
    }).catch(() => null);
    const user = await Promise.race([lookup, timeout]).finally(() => deadline.abort());
    return user?.name ?? null;
  }
}

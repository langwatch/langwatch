import type { GatewayRealtimeSession } from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

import type { ElevenLabsConversationReport } from "../channels/elevenlabs-conversation.channel.ts";
import {
  REALTIME_GATEWAY_HELD_KIND,
  REALTIME_ORPHAN_SILENCE_MS,
  REALTIME_SETTLED_KINDS,
} from "../rules/gateway-realtime-session-metering.rules.ts";
import {
  GatewayRealtimeSessionMeteringService,
  REALTIME_SETTLEMENT_REASONS,
} from "./gateway-realtime-session-metering.service.ts";
import type { RealtimeSessionReconciliationRepository } from "./gateway-realtime-session-reconciliation.service.ts";
import {
  GatewayRealtimeSessionService,
  REALTIME_EXPIRY_CLOSE_REASON,
  REALTIME_OPEN_SESSION_WINDOW_MS,
  type GatewayRealtimeSessionCollaborators,
} from "./gateway-realtime-session.service.ts";

/** The vendor the reconciliation sweep reads back from. */
const RECONCILED_VENDOR = "elevenlabs";

/** The session rows the sweep reads and closes, through the feature's own operations. */
export class GatewayRealtimeSessionSweepService implements RealtimeSessionReconciliationRepository {
  static create(
    collaborators: GatewayRealtimeSessionCollaborators,
  ): GatewayRealtimeSessionSweepService {
    return new GatewayRealtimeSessionSweepService(collaborators);
  }

  readonly #operations = GatewayRealtimeSessionService.create();
  readonly #metering = GatewayRealtimeSessionMeteringService.create();

  private constructor(private readonly collaborators: GatewayRealtimeSessionCollaborators) {}

  expireStaleSessions(input: { now: Instant }): Promise<number> {
    return this.#operations.expireStaleRealtimeSessions({
      now: input.now,
      collaborators: this.collaborators,
    });
  }

  listOrphanedGatewaySessions(input: {
    now: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]> {
    return this.collaborators.sessions.findOrphanedGatewaySessions({
      kind: REALTIME_GATEWAY_HELD_KIND,
      silentSince: input.now.subtract({ milliseconds: REALTIME_ORPHAN_SILENCE_MS }),
      limit: input.limit,
    });
  }

  listSessionsAwaitingSettlement(input: {
    now: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]> {
    return this.collaborators.sessions.findAwaitingSettlement({
      kinds: REALTIME_SETTLED_KINDS,
      mintedBefore: input.now.subtract({ milliseconds: REALTIME_OPEN_SESSION_WINDOW_MS }),
      expiredReason: REALTIME_EXPIRY_CLOSE_REASON,
      limit: input.limit,
    });
  }

  settleSession(input: {
    session: GatewayRealtimeSession;
    orphaned: boolean;
    now: Instant;
  }): Promise<"estimated" | "closed"> {
    return this.#metering.settleUnreportedRealtimeSession({
      session: input.session,
      now: input.now,
      ...(input.orphaned ? { reason: REALTIME_SETTLEMENT_REASONS.orphaned } : {}),
      collaborators: this.collaborators,
    });
  }

  listOpenElevenLabsSessions(input: {
    mintedBefore: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]> {
    return this.collaborators.sessions.findOpenAwaitingVendorReport({
      vendor: RECONCILED_VENDOR,
      ...input,
    });
  }

  async releaseMissingVendorConversation(input: {
    sessionId: string;
    projectId: string;
    reason: string;
  }): Promise<void> {
    await this.#operations.releaseRealtimeSession({
      ...input,
      status: "EXPIRED",
      collaborators: this.collaborators,
    });
  }

  async confirmSession(input: {
    session: GatewayRealtimeSession;
    audioMs: number;
    vendorCostRaw: ElevenLabsConversationReport["metadata"] | null;
    durationMs: number;
    reason: string;
  }): Promise<void> {
    await this.#operations.closeAndConfirmRealtimeSession({
      session: input.session,
      usage: { audio_ms: input.audioMs },
      vendorCostRaw: input.vendorCostRaw,
      durationMs: input.durationMs,
      reason: input.reason,
      collaborators: this.collaborators,
    });
  }
}

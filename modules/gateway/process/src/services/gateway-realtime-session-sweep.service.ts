import type { GatewayRealtimeSession } from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

import type { ElevenLabsConversationReport } from "../channels/elevenlabs-conversation.channel.ts";
import type { RealtimeSessionReconciliationRepository } from "./gateway-realtime-session-reconciliation.service.ts";
import {
  GatewayRealtimeSessionService,
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

  private constructor(private readonly collaborators: GatewayRealtimeSessionCollaborators) {}

  expireStaleSessions(input: { now: Instant }): Promise<number> {
    return this.#operations.expireStaleRealtimeSessions({
      now: input.now,
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

  confirmSession(input: {
    session: GatewayRealtimeSession;
    audioMs: number;
    vendorCostRaw: ElevenLabsConversationReport["metadata"] | null;
    durationMs: number;
    reason: string;
  }): Promise<void> {
    return this.#operations.closeAndConfirmRealtimeSession({
      session: input.session,
      usage: { audio_ms: input.audioMs },
      vendorCostRaw: input.vendorCostRaw,
      durationMs: input.durationMs,
      reason: input.reason,
      collaborators: this.collaborators,
    });
  }
}

import type {
  GatewayRealtimeSession,
  GatewayRealtimeSessionStatus,
} from "@langwatch/prisma-client/generated";

/** What a reserve attempt answers. */
export type ReserveResult =
  | { ok: true }
  | { ok: false; reason: "session_limit"; open: number; limit: number };

/** The columns a mint writes onto a new session row. */
export type NewGatewayRealtimeSession = {
  id: string;
  projectId: string;
  organizationId: string;
  virtualKeyId: string;
  modelProviderId: string;
  vendor: string;
  agentId: string | null;
  model: string;
  traceId: string | null;
  requestedModel: string | null;
};

/**
 * The record of brokered realtime voice sessions.
 *
 * `reserve` is one method rather than a read and a write because the cap only
 * holds if the count and the insert happen under the same per-key lock: two
 * racing mints that both read the count before either insert lands would each
 * see room, and a key limited to one would hold two sessions.
 */
export abstract class GatewayRealtimeSessionRepository {
  abstract reserve(input: {
    session: NewGatewayRealtimeSession;
    /** Rows minted before this are expired first, under the same lock. */
    staleBefore: Date;
    closeReason: string;
  }): Promise<ReserveResult>;
  abstract correlate(input: {
    sessionId: string;
    projectId: string;
    vendorConversationId: string;
  }): Promise<boolean>;
  /** Closes a session that never opened. Answers whether one was still open. */
  abstract release(input: {
    sessionId: string;
    projectId: string;
    status: GatewayRealtimeSessionStatus;
    closeReason: string;
  }): Promise<boolean>;
  abstract tryFindByVendorConversationId(input: {
    organizationId: string;
    vendor: string;
    vendorConversationId: string;
  }): Promise<GatewayRealtimeSession | null>;
  abstract tryFindById(input: {
    organizationId: string;
    vendor: string;
    id: string;
  }): Promise<GatewayRealtimeSession | null>;
  abstract findOpenSince(input: {
    organizationId: string;
    vendor: string;
    modelProviderId: string;
    since: Date;
    limit: number;
  }): Promise<GatewayRealtimeSession[]>;
  abstract tryFindForReport(input: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
  }): Promise<GatewayRealtimeSession | null>;
  /** Closes an OPEN or EXPIRED session. Answers how many rows it closed. */
  abstract close(input: {
    sessionId: string;
    projectId: string;
    closedAt: Date;
    closeReason: string;
    vendorCostRaw?: unknown;
  }): Promise<number>;
  abstract expireStale(input: {
    virtualKeyId?: string;
    now: Date;
    staleBefore: Date;
    closeReason: string;
  }): Promise<number>;
}

import type {
  GatewayRealtimeSession,
  GatewayRealtimeSessionReport,
  GatewayRealtimeSessionStatus,
  SpendUsage,
} from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

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
  kind: string | null;
  metering: string | null;
  transcriptionModel: string | null;
  credentialExpiresAt: Instant | null;
};

/** One usage report as it is written: its key, what it was priced under and what it cost. */
export type NewGatewayRealtimeSessionReport = {
  sessionId: string;
  projectId: string;
  reportKey: string;
  model: string;
  usage: SpendUsage;
  costNanoUsd: number;
  recordedAt: Instant;
};

/**
 * The record of brokered realtime voice sessions. `reserve` is one method,
 * not a read and a write, because the cap only holds under one per-key lock.
 */
export abstract class GatewayRealtimeSessionRepository {
  abstract reserve(input: {
    session: NewGatewayRealtimeSession;
    /** Rows minted before this are expired first, under the same lock. */
    staleBefore: Instant;
    closeReason: string;
  }): Promise<ReserveResult>;
  /** Records what the mint learned after booking. Answers whether the session exists. */
  abstract correlate(input: {
    sessionId: string;
    projectId: string;
    vendorConversationId?: string;
    credentialExpiresAt?: Instant;
  }): Promise<boolean>;
  /** Closes a session that never opened. Answers whether one was still open. */
  abstract release(input: {
    sessionId: string;
    projectId: string;
    status: GatewayRealtimeSessionStatus;
    closeReason: string;
  }): Promise<boolean>;
  abstract findByVendorConversationId(input: {
    organizationId: string;
    vendor: string;
    vendorConversationId: string;
  }): Promise<GatewayRealtimeSession | null>;
  abstract findById(input: {
    organizationId: string;
    vendor: string;
    id: string;
  }): Promise<GatewayRealtimeSession | null>;
  abstract findOpenSince(input: {
    organizationId: string;
    vendor: string;
    modelProviderId: string;
    since: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]>;
  /**
   * Open sessions the vendor still owes a report for, oldest first. The
   * reconciliation sweep's read: system-owned and across every tenant, so it
   * takes no organization.
   */
  abstract findOpenAwaitingVendorReport(input: {
    vendor: string;
    mintedBefore: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]>;
  abstract findForReport(input: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
  }): Promise<GatewayRealtimeSession | null>;
  /** Closes an OPEN or EXPIRED session. Answers how many rows it closed. */
  abstract close(input: {
    sessionId: string;
    projectId: string;
    closedAt: Instant;
    closeReason: string;
    vendorCostRaw?: unknown;
    /** What the session's own record confirmed, added to its recorded total by the same write. */
    settledCostNanoUsd?: number;
  }): Promise<number>;
  abstract findReport(input: {
    sessionId: string;
    projectId: string;
    reportKey: string;
  }): Promise<GatewayRealtimeSessionReport | null>;
  /**
   * Writes one report and, only when it is new, adds it to the session's running total.
   * Answers whether the report was new: a key already recorded changes nothing.
   */
  abstract recordReport(input: { report: NewGatewayRealtimeSessionReport }): Promise<boolean>;
  abstract findReports(input: {
    sessionId: string;
    projectId: string;
  }): Promise<GatewayRealtimeSessionReport[]>;
  /** The cost of the reports recorded at or after `since`. */
  abstract sumReportCostSince(input: {
    sessionId: string;
    projectId: string;
    since: Instant;
  }): Promise<number>;
  /**
   * Open sessions the gateway meters itself that have gone silent: no report, or no mint,
   * at or after `silentSince`. Their gateway is gone, so nothing is metering the call.
   */
  abstract findOrphanedGatewaySessions(input: {
    kind: string;
    silentSince: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]>;
  /**
   * Metered sessions past the open window that nothing closed, oldest first: still OPEN, or
   * EXPIRED by the window (`expiredReason`). The settlement sweep's read, across every tenant.
   */
  abstract findAwaitingSettlement(input: {
    kinds: readonly string[];
    mintedBefore: Instant;
    expiredReason: string;
    limit: number;
  }): Promise<GatewayRealtimeSession[]>;
  abstract expireStale(input: {
    virtualKeyId?: string;
    now: Instant;
    staleBefore: Instant;
    closeReason: string;
  }): Promise<number>;
}

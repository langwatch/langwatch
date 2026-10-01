import type {
  GatewayRealtimeSession,
  GatewayRealtimeSessionStatus,
} from "@langwatch/gateway-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  GatewayRealtimeSessionRepository,
  type NewGatewayRealtimeSession,
  type ReserveResult,
} from "../gateway-realtime-session.repository.ts";

/** The Postgres twin's rows in a map; a key's cap is what the test names, or none. */
export class MemoryGatewayRealtimeSessionRepository extends GatewayRealtimeSessionRepository {
  static create(
    input: { maxOpenSessions?: Readonly<Record<string, number>> } = {},
  ): MemoryGatewayRealtimeSessionRepository {
    return new MemoryGatewayRealtimeSessionRepository(input.maxOpenSessions ?? {});
  }

  readonly rows = new Map<string, GatewayRealtimeSession>();

  private constructor(private readonly maxOpenSessions: Readonly<Record<string, number>>) {
    super();
  }

  async reserve({
    session,
    staleBefore,
    closeReason,
  }: {
    session: NewGatewayRealtimeSession;
    staleBefore: Instant;
    closeReason: string;
  }): Promise<ReserveResult> {
    const limit = this.maxOpenSessions[session.virtualKeyId];
    if (limit !== undefined) {
      this.expire({
        virtualKeyId: session.virtualKeyId,
        now: nowInstant(),
        staleBefore,
        closeReason,
      });
      const open = this.all().filter(
        (row) => row.virtualKeyId === session.virtualKeyId && row.status === "OPEN",
      ).length;
      if (open >= limit) return { ok: false, reason: "session_limit", open, limit };
    }
    const now = nowInstant();
    this.rows.set(session.id, {
      ...session,
      vendorConversationId: null,
      status: "OPEN",
      mintedAt: now,
      closedAt: null,
      closeReason: null,
      vendorCostRaw: null,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true };
  }

  async correlate(input: {
    sessionId: string;
    projectId: string;
    vendorConversationId: string;
  }): Promise<boolean> {
    const row = this.owned(input);
    if (!row) return false;
    this.rows.set(row.id, { ...row, vendorConversationId: input.vendorConversationId });

    return true;
  }

  async release(input: {
    sessionId: string;
    projectId: string;
    status: GatewayRealtimeSessionStatus;
    closeReason: string;
  }): Promise<boolean> {
    const row = this.owned(input);
    if (row?.status !== "OPEN") return false;
    const now = nowInstant();
    this.rows.set(row.id, {
      ...row,
      status: input.status,
      closedAt: now,
      closeReason: input.closeReason,
      updatedAt: now,
    });

    return true;
  }

  async findByVendorConversationId(input: {
    organizationId: string;
    vendor: string;
    vendorConversationId: string;
  }): Promise<GatewayRealtimeSession | null> {
    return (
      this.all().find(
        (row) =>
          row.organizationId === input.organizationId &&
          row.vendor === input.vendor &&
          row.vendorConversationId === input.vendorConversationId,
      ) ?? null
    );
  }

  async findById(input: {
    organizationId: string;
    vendor: string;
    id: string;
  }): Promise<GatewayRealtimeSession | null> {
    const row = this.rows.get(input.id);
    return row?.organizationId === input.organizationId && row.vendor === input.vendor ? row : null;
  }

  async findOpenSince(input: {
    organizationId: string;
    vendor: string;
    modelProviderId: string;
    since: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]> {
    return this.all()
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.vendor === input.vendor &&
          row.modelProviderId === input.modelProviderId &&
          row.status === "OPEN" &&
          row.mintedAt.epochMilliseconds > input.since.epochMilliseconds,
      )
      .slice(0, input.limit);
  }

  async findOpenAwaitingVendorReport(input: {
    vendor: string;
    mintedBefore: Instant;
    limit: number;
  }): Promise<GatewayRealtimeSession[]> {
    return this.all()
      .filter(
        (row) =>
          row.vendor === input.vendor &&
          row.status === "OPEN" &&
          row.vendorConversationId !== null &&
          row.mintedAt.epochMilliseconds < input.mintedBefore.epochMilliseconds,
      )
      .toSorted((a, b) => a.mintedAt.epochMilliseconds - b.mintedAt.epochMilliseconds)
      .slice(0, input.limit);
  }

  async findForReport(input: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
  }): Promise<GatewayRealtimeSession | null> {
    const row = this.owned(input);
    return row?.virtualKeyId === input.virtualKeyId ? row : null;
  }

  async close(input: {
    sessionId: string;
    projectId: string;
    closedAt: Instant;
    closeReason: string;
    vendorCostRaw?: unknown;
  }): Promise<number> {
    const row = this.owned(input);
    if (row?.status !== "OPEN" && row?.status !== "EXPIRED") return 0;
    this.rows.set(row.id, {
      ...row,
      status: "CLOSED",
      closedAt: input.closedAt,
      closeReason: input.closeReason,
      vendorCostRaw:
        input.vendorCostRaw === undefined ? row.vendorCostRaw : toJson(input.vendorCostRaw),
      updatedAt: nowInstant(),
    });

    return 1;
  }

  async expireStale(input: {
    virtualKeyId?: string;
    now: Instant;
    staleBefore: Instant;
    closeReason: string;
  }): Promise<number> {
    return this.expire(input);
  }

  private expire(input: {
    virtualKeyId?: string;
    now: Instant;
    staleBefore: Instant;
    closeReason: string;
  }): number {
    const stale = this.all().filter(
      (row) =>
        row.status === "OPEN" &&
        row.mintedAt.epochMilliseconds < input.staleBefore.epochMilliseconds &&
        (input.virtualKeyId === undefined || row.virtualKeyId === input.virtualKeyId),
    );
    for (const row of stale) {
      this.rows.set(row.id, {
        ...row,
        status: "EXPIRED",
        closedAt: input.now,
        closeReason: input.closeReason,
        updatedAt: nowInstant(),
      });
    }

    return stale.length;
  }

  private owned(input: { sessionId: string; projectId: string }): GatewayRealtimeSession | null {
    const row = this.rows.get(input.sessionId);
    return row?.projectId === input.projectId ? row : null;
  }

  private all(): GatewayRealtimeSession[] {
    return [...this.rows.values()];
  }
}

/** A cost payload stored as the jsonb column would hand it back. */
function toJson(value: unknown): GatewayRealtimeSession["vendorCostRaw"] {
  return JSON.parse(JSON.stringify(value));
}

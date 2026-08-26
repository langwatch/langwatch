// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

const logger = createLogger("langwatch:scim:request-log");

/**
 * How long a recorded request is kept (ADR-126).
 *
 * This is evidence, not truth, so it has a window an event log would never
 * have. Thirty days is the span of the question it answers — "did the sync I
 * configured arrive, and what did you make of it" — with room for somebody to
 * come back to it after a weekend and a support round trip.
 */
export const SCIM_REQUEST_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** What a refusal is called, so a reader branches on the slug and never on
 *  the sentence beside it. */
/**
 * How many expired rows one statement removes.
 *
 * Large enough that a normal sweep is one or two round trips, small enough
 * that no single delete holds locks or writes WAL for long. The sweep loops
 * until a batch comes back short, so this bounds the statement rather than
 * the work.
 */
const SCIM_REQUEST_LOG_SWEEP_BATCH = 5_000;

export type ScimRefusalReason =
  | "plan_not_entitled"
  | "unauthorized"
  | "malformed_body"
  | "invalid_resource"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "unsupported"
  | "internal_error";

export interface ScimRequestRecord {
  organizationId: string;
  connectionId: string | null;
  method: string;
  resource: string;
  status: number;
  reason: ScimRefusalReason | null;
  detail: string | null;
}

/**
 * The requests a directory made, and what we answered.
 *
 * WRITES NEVER FAIL A REQUEST. This records what already happened; a
 * provisioning call that worked must not be turned into a failure because the
 * evidence could not be filed, and one that was refused must keep the refusal
 * the caller was owed. So a write that throws is logged and swallowed — and
 * logged, because a silently empty feed is exactly the symptom this table
 * exists to end.
 */
export class ScimRequestLogService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ScimRequestLogService {
    return new ScimRequestLogService(prisma);
  }

  async record(request: ScimRequestRecord): Promise<void> {
    try {
      await this.prisma.scimRequestLog.create({ data: request });
    } catch (err) {
      logger.error(
        {
          err,
          organizationId: request.organizationId,
          connectionId: request.connectionId,
          status: request.status,
        },
        "a SCIM request could not be recorded (the request itself was answered)",
      );
    }
  }

  /**
   * Everything a connection has served, newest first.
   *
   * Bounded by a limit rather than paged, because the question it answers is
   * about the last few minutes. A reader who needs more than this is asking a
   * different question, and the answer to that one is the sync log.
   */
  async findForConnection({
    organizationId,
    connectionId,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }) {
    return this.prisma.scimRequestLog.findMany({
      // The organization is in the predicate as well as the connection: a
      // connection id is not a tenant, and this table is read by a surface
      // that has one.
      where: { organizationId, connectionId },
      orderBy: { occurredAt: "desc" },
      take: limit,
    });
  }

  /**
   * Drop what has aged out.
   *
   * Returns the count so the caller can say what it did rather than assert
   * that it ran.
   */
  async sweepExpired({ now }: { now: Date }): Promise<number> {
    const before = new Date(now.getTime() - SCIM_REQUEST_LOG_RETENTION_MS);
    let swept = 0;

    // Batched, because this table takes a row per SCIM request — including
    // every read a full directory sync issues — and the backlog it clears is
    // therefore large and lumpy. One unbounded `deleteMany` after any worker
    // outage, or on the first sweep once thirty days have accrued, holds the
    // row locks and writes the whole delete's WAL in a single transaction.
    // The loop stops when a batch comes back short, so a quiet table costs
    // exactly one statement.
    for (;;) {
      const expiring = await this.prisma.scimRequestLog.findMany({
        where: { occurredAt: { lt: before } },
        select: { id: true },
        take: SCIM_REQUEST_LOG_SWEEP_BATCH,
      });
      if (expiring.length === 0) break;

      const { count } = await this.prisma.scimRequestLog.deleteMany({
        where: { id: { in: expiring.map((row) => row.id) } },
      });
      swept += count;
      if (expiring.length < SCIM_REQUEST_LOG_SWEEP_BATCH) break;
    }

    return swept;
  }
}

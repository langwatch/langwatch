// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories
// implement the interface as intentional no-ops.

import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { toPgTimestampUtc } from "./pg-timestamp.ts";
import type { ScheduledJobRecord, ScheduledJobStore } from "../../schedule/scheduler.types.ts";

/**
 * Prisma-backed `ScheduledJob` repository. Reads use `$queryRaw` for cross-tenant
 * global scans; writes are project-scoped and checked by the multitenancy guard.
 */
export class PrismaScheduledJobStore implements ScheduledJobStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findDue({ now, limit }: { now: Date; limit: number }): Promise<ScheduledJobRecord[]> {
    // Cross-tenant due-scan, indexed by (active, nextRunAt), soonest first so
    // a bounded scan drains the backlog in calendar order. The `-- @tenancy:`
    // marker is the guard's explicit opt-out for a genuinely cross-tenant
    // system query (the per-row conditional claim is the tenancy-safe write).
    // `now` is a naive-UTC `::timestamp` so the `<=` comparison is
    // timezone-independent (a raw JS Date binds as timestamptz and would shift
    // the boundary by the session offset — firing future jobs hours early).
    const rows = await this.prisma.$queryRaw<ScheduledJobRecord[]>`
      SELECT "id", "projectId", "targetType", "targetId", "cron", "timezone",
             "nextRunAt", "lastSlot", "currentSlot", "attempts", "lastError",
             "active", "createdAt", "updatedAt"
      FROM "ScheduledJob"
      WHERE "active" = true AND "nextRunAt" <= ${toPgTimestampUtc(now)}::timestamp
      ORDER BY "nextRunAt" ASC
      LIMIT ${limit}
      -- @tenancy: scheduler cross-tenant due-scan (system-owned primitive)
    `;
    return rows;
  }

  async earliestActiveNextRunAt(): Promise<Date | null> {
    // The instant the loop sleeps until — MIN(nextRunAt) across all tenants.
    // No comparison, so no timezone hazard: Prisma reads the naive column back
    // as a UTC Date, which the loop diffs against Date.now() (both UTC).
    const rows = await this.prisma.$queryRaw<{ nextRunAt: Date | null }[]>`
      SELECT MIN("nextRunAt") AS "nextRunAt"
      FROM "ScheduledJob"
      WHERE "active" = true
      -- @tenancy: scheduler cross-tenant earliest-due peek (system primitive)
    `;
    return rows[0]?.nextRunAt ?? null;
  }

  async claim({
    id,
    projectId,
    expectedNextRunAt,
    slot,
    leaseUntil,
  }: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    slot: Date;
    leaseUntil: Date;
  }): Promise<boolean> {
    // Conditional UPDATE on exact nextRunAt ensures exactly-once execution via
    // Postgres row-locking. Must be raw (not updateMany) for atomic multi-predicate
    // safety and timezone correctness; COALESCE preserves pinned slot on retry/refire.
    const affected = await this.prisma.$executeRaw`
      UPDATE "ScheduledJob"
      SET "nextRunAt" = ${toPgTimestampUtc(leaseUntil)}::timestamp,
          "currentSlot" = COALESCE("currentSlot", ${toPgTimestampUtc(slot)}::timestamp),
          "updatedAt" = now()
      WHERE "id" = ${id}
        AND "projectId" = ${projectId}
        AND "nextRunAt" = ${toPgTimestampUtc(expectedNextRunAt)}::timestamp
    `;
    return affected === 1;
  }

  async settleClaim({
    id,
    projectId,
    expectedLease,
    nextRunAt,
    lastSlot,
    currentSlot,
    attempts,
    lastError,
  }: {
    id: string;
    projectId: string;
    expectedLease: Date;
    nextRunAt: Date;
    lastSlot: Date | null;
    currentSlot: Date | null;
    attempts: number;
    lastError: string | null;
  }): Promise<boolean> {
    // Settle a lease this worker owns: a CONDITIONAL update guarded on the exact
    // `leaseUntil` value `claim` set. Only the lease-holder matches; a lease
    // that expired and was re-claimed by another worker → 0 rows → `false`.
    // Single raw UPDATE for the same two reasons as `claim` (atomic guard +
    // naive-UTC `::timestamp` comparison). `lastSlot` is nullable: binding a JS
    // `null` yields `NULL::timestamp` (SQL NULL), so "leave unchanged" is
    // expressed by passing the row's existing value back. `lastError` is a text
    // column — binds directly, `null` → SQL NULL. `attempts` binds as int.
    const affected = await this.prisma.$executeRaw`
      UPDATE "ScheduledJob"
      SET "nextRunAt" = ${toPgTimestampUtc(nextRunAt)}::timestamp,
          "lastSlot" = ${lastSlot === null ? null : toPgTimestampUtc(lastSlot)}::timestamp,
          "currentSlot" = ${currentSlot === null ? null : toPgTimestampUtc(currentSlot)}::timestamp,
          "attempts" = ${attempts},
          "lastError" = ${lastError},
          "updatedAt" = now()
      WHERE "id" = ${id}
        AND "projectId" = ${projectId}
        AND "nextRunAt" = ${toPgTimestampUtc(expectedLease)}::timestamp
    `;
    return affected === 1;
  }

  async upsertForTarget({
    projectId,
    targetType,
    targetId,
    cron,
    timezone,
    nextRunAt,
  }: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Date;
  }): Promise<void> {
    // Guard-safe upsert: update-first (projectId-scoped WHERE), create if the
    // row is absent. A plain `prisma.upsert` can't be used — its WHERE is the
    // (targetType, targetId) unique, which carries no projectId and the
    // multitenancy guard would reject it. An edit re-marks the row active and
    // refreshes the calendar; `lastSlot` (fire history) is left untouched.
    // (Model-layer write, so Prisma handles the naive-UTC timestamp binding.)
    // `currentSlot` resets on edit: the calendar changed, so any in-flight
    // retry belongs to the OLD schedule and must not misattribute the next fire.
    const { count } = await this.prisma.scheduledJob.updateMany({
      where: { projectId, targetType, targetId },
      data: { cron, timezone, nextRunAt, active: true, currentSlot: null },
    });
    if (count === 0) {
      try {
        await this.prisma.scheduledJob.create({
          data: {
            projectId,
            targetType,
            targetId,
            cron,
            timezone,
            nextRunAt,
            active: true,
          },
        });
      } catch (error) {
        // The (targetType, targetId) unique makes create-if-absent race-safe:
        // when two callers see the row missing at once (e.g. the boot-time
        // report-schedule reconciliation runs on every worker, ADR-044), one
        // create wins and the other hits P2002. Both wanted the same row to
        // exist, so treat the loser as a success rather than surfacing a spurious
        // boot error. Any other failure still throws.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
          throw error;
        }
      }
    }
  }

  async deactivateForTarget({
    projectId,
    targetType,
    targetId,
  }: {
    projectId: string;
    targetType: string;
    targetId: string;
  }): Promise<void> {
    // updateMany (not update) so deleting a target that never had a schedule
    // is a harmless no-op rather than a "record not found" throw.
    await this.prisma.scheduledJob.updateMany({
      where: { projectId, targetType, targetId },
      data: { active: false },
    });
  }

  async findAllForProject({
    projectId,
    targetType,
  }: {
    projectId: string;
    targetType: string;
  }): Promise<ScheduledJobRecord[]> {
    // Single index hit: `@@index([projectId])` plus a small targetType filter.
    return this.prisma.scheduledJob.findMany({
      where: { projectId, targetType },
      orderBy: { nextRunAt: "asc" },
    });
  }

  async listForOps({ limit }: { limit: number }): Promise<ScheduledJobRecord[]> {
    // Cross-tenant operator read (all projects): active jobs first, then by
    // soonest next fire. The `-- @tenancy:` marker is the guard's sanctioned
    // opt-out for a system-owned cross-tenant view (read-only, never fires).
    return this.prisma.$queryRaw<ScheduledJobRecord[]>`
      SELECT "id", "projectId", "targetType", "targetId", "cron", "timezone",
             "nextRunAt", "lastSlot", "currentSlot", "attempts", "lastError",
             "active", "createdAt", "updatedAt"
      FROM "ScheduledJob"
      ORDER BY "active" DESC, "nextRunAt" ASC
      LIMIT ${limit}
      -- @tenancy: scheduler cross-tenant ops read (system-owned, read-only)
    `;
  }

  async listPausedForOps({
    limit,
  }: {
    limit: number;
  }): Promise<{ rows: ScheduledJobRecord[]; total: number }> {
    // Its own query rather than a filter over `listForOps`: that one orders
    // `active DESC`, and in Postgres `true > false`, so the inactive rows sort
    // to the very end — precisely what its LIMIT drops. A caller filtering
    // that page finds nothing the moment the fleet outgrows the page.
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<ScheduledJobRecord[]>`
        SELECT "id", "projectId", "targetType", "targetId", "cron", "timezone",
               "nextRunAt", "lastSlot", "currentSlot", "attempts", "lastError",
               "active", "createdAt", "updatedAt"
        FROM "ScheduledJob"
        WHERE "active" = false
        ORDER BY "nextRunAt" ASC
        LIMIT ${limit}
        -- @tenancy: scheduler cross-tenant ops read (system-owned, read-only)
      `,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS "total"
        FROM "ScheduledJob"
        WHERE "active" = false
        -- @tenancy: scheduler cross-tenant ops read (system-owned, read-only)
      `,
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  // ── Operator control (ADR-091) ────────────────────────────────────────

  async tryFindByIdForOps({ id }: { id: string }): Promise<ScheduledJobRecord | null> {
    const rows = await this.prisma.$queryRaw<ScheduledJobRecord[]>`
      SELECT "id", "projectId", "targetType", "targetId", "cron", "timezone",
             "nextRunAt", "lastSlot", "currentSlot", "attempts", "lastError",
             "active", "createdAt", "updatedAt"
      FROM "ScheduledJob"
      WHERE "id" = ${id}
      LIMIT 1
      -- @tenancy: scheduler cross-tenant ops read (system-owned, read-only)
    `;
    return rows[0] ?? null;
  }

  async setActiveForOps({
    id,
    projectId,
    active,
  }: {
    id: string;
    projectId: string;
    active: boolean;
  }): Promise<boolean> {
    // Unconditional on nextRunAt: pause is about future scans, not current state.
    // Don't bump updatedAt; it's the heartbeat the stale-slot guard relies on.
    const affected = await this.prisma.$executeRaw`
      UPDATE "ScheduledJob"
      SET "active" = ${active}
      WHERE "id" = ${id}
        AND "projectId" = ${projectId}
      -- @tenancy: scheduler cross-tenant ops control (system-owned, ops:manage)
    `;
    return affected === 1;
  }

  async releaseSlotForOps({
    id,
    projectId,
    expectedNextRunAt,
    now,
  }: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    now: Date;
  }): Promise<boolean> {
    const affected = await this.prisma.$executeRaw`
      UPDATE "ScheduledJob"
      SET "currentSlot" = NULL,
          "attempts" = 0,
          "lastError" = NULL,
          "nextRunAt" = ${toPgTimestampUtc(now)}::timestamp,
          "updatedAt" = now()
      WHERE "id" = ${id}
        AND "projectId" = ${projectId}
        AND "nextRunAt" = ${toPgTimestampUtc(expectedNextRunAt)}::timestamp
      -- @tenancy: scheduler cross-tenant ops control (system-owned, ops:manage)
    `;
    return affected === 1;
  }

  async requestImmediateRunForOps({
    id,
    projectId,
    expectedNextRunAt,
    now,
  }: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    now: Date;
  }): Promise<boolean> {
    // Only nextRunAt moves; manual runs use the same slot mechanics as scheduled
    // ones. currentSlot IS NULL guard here prevents double-delivery during leases.
    const affected = await this.prisma.$executeRaw`
      UPDATE "ScheduledJob"
      SET "nextRunAt" = ${toPgTimestampUtc(now)}::timestamp,
          "updatedAt" = now()
      WHERE "id" = ${id}
        AND "projectId" = ${projectId}
        AND "active" = true
        AND "currentSlot" IS NULL
        AND "nextRunAt" = ${toPgTimestampUtc(expectedNextRunAt)}::timestamp
      -- @tenancy: scheduler cross-tenant ops control (system-owned, ops:manage)
    `;
    return affected === 1;
  }
}

/**
 * No-op `ScheduledJob` repository for the null preset (web boot / tests) where
 * no scheduler runs and there is no `prisma` in scope. Reads return empty,
 * writes are no-ops, and `claim` never wins — nothing fires. Mirrors the
 * sibling `Null*` ops repositories so the null preset never touches Postgres.
 */
export class NullScheduledJobStore implements ScheduledJobStore {
  async findDue(): Promise<ScheduledJobRecord[]> {
    return [];
  }
  async earliestActiveNextRunAt(): Promise<Date | null> {
    return null;
  }
  async claim(): Promise<boolean> {
    return false;
  }
  async settleClaim(): Promise<boolean> {
    return false;
  }
  async upsertForTarget(): Promise<void> {}
  async deactivateForTarget(): Promise<void> {}
  async findAllForProject(): Promise<ScheduledJobRecord[]> {
    return [];
  }
  async listForOps(): Promise<ScheduledJobRecord[]> {
    return [];
  }
  async listPausedForOps(): Promise<{
    rows: ScheduledJobRecord[];
    total: number;
  }> {
    return { rows: [], total: 0 };
  }
  async tryFindByIdForOps(): Promise<ScheduledJobRecord | null> {
    return null;
  }
  async setActiveForOps(): Promise<boolean> {
    return false;
  }
  async releaseSlotForOps(): Promise<boolean> {
    return false;
  }
  async requestImmediateRunForOps(): Promise<boolean> {
    return false;
  }
}

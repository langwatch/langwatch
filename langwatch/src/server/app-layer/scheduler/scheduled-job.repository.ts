import type { PrismaClient } from "@prisma/client";
import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "./scheduler.types";

/**
 * Render a `Date` as a naive-UTC timestamp literal (`YYYY-MM-DD HH:MM:SS.mmm`)
 * for raw-SQL comparison/assignment against the `timestamp without time zone`
 * columns. Prisma's model layer stores JS Dates in `timestamp` columns as the
 * naive UTC wall-clock; but in RAW SQL Prisma binds a JS `Date` as a
 * `timestamptz`, so `"nextRunAt" = $date` compares across the session timezone
 * (e.g. Europe/Amsterdam) and NEVER matches. Binding the naive-UTC string and
 * casting `::timestamp` makes the comparison timezone-independent.
 */
const toPgTimestampUtc = (d: Date): string =>
  d.toISOString().slice(0, 23).replace("T", " ");

/**
 * Prisma-backed `ScheduledJob` repository (ADR-042 §4). The durable Postgres
 * row is the source of truth; the service layer (SchedulerService) depends on
 * the `ScheduledJobRepository` interface, never on Prisma directly.
 *
 * The two READS are cross-tenant global scans (one scheduler serves every
 * project), so they use `$queryRaw` with the guard's sanctioned
 * `-- @tenancy:` opt-out (see `dbMultiTenancyProtection.ts`). The WRITES are
 * project-scoped — each carries `projectId` — so the multitenancy guard
 * accepts them and no write can cross tenants.
 */
export class PrismaScheduledJobRepository implements ScheduledJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findDue({
    now,
    limit,
  }: {
    now: Date;
    limit: number;
  }): Promise<ScheduledJobRecord[]> {
    // Cross-tenant due-scan, indexed by (active, nextRunAt), soonest first so
    // a bounded scan drains the backlog in calendar order. The `-- @tenancy:`
    // marker is the guard's explicit opt-out for a genuinely cross-tenant
    // system query (the per-row conditional claim is the tenancy-safe write).
    // `now` is a naive-UTC `::timestamp` so the `<=` comparison is
    // timezone-independent (a raw JS Date binds as timestamptz and would shift
    // the boundary by the session offset — firing future jobs hours early).
    const rows = await this.prisma.$queryRaw<ScheduledJobRecord[]>`
      SELECT "id", "projectId", "targetType", "targetId", "cron", "timezone",
             "nextRunAt", "lastSlot", "active", "createdAt", "updatedAt"
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
    nextRunAt,
    lastSlot,
  }: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    nextRunAt: Date;
    lastSlot: Date;
  }): Promise<boolean> {
    // The correctness core (ADR-042 §4): a CONDITIONAL update guarded on the
    // exact `nextRunAt` we read during the due-scan. N workers racing the same
    // due row all issue this UPDATE; Postgres row-locks serialise them, the
    // first flips `nextRunAt` so every other WHERE no longer matches (0 rows
    // affected). Exactly one worker wins the slot — the whole exactly-once
    // guarantee, no Redis required.
    //
    // MUST be a single raw UPDATE, NOT prisma.updateMany, for TWO reasons:
    //   1. When the where contains the `@id`, Prisma collapses the compound
    //      filter to `WHERE id IN (...) AND 1=1`, silently DROPPING the
    //      `nextRunAt = expected` guard — making the claim unconditional so
    //      every racer "wins" (verified: concurrent updateMany claims all
    //      returned count=1). Even keyed on the (targetType,targetId) unique,
    //      Prisma applies the extra predicate in a SEPARATE pre-SELECT — a
    //      non-atomic read-then-write that races to multiple winners.
    //   2. Timezone safety — see `toPgTimestampUtc`. A raw JS Date binds as
    //      timestamptz and the equality never matches under a non-UTC session
    //      timezone; the naive-UTC `::timestamp` literals compare correctly.
    // Keeping the guard in ONE atomic UPDATE lets Postgres row-lock +
    // EvalPlanQual pick exactly one winner (verified: 3 concurrent claims →
    // 1 winner). The `"projectId"` predicate also satisfies the multitenancy
    // guard's raw-query tenancy check; it always equals the row's own project.
    const affected = await this.prisma.$executeRaw`
      UPDATE "ScheduledJob"
      SET "nextRunAt" = ${toPgTimestampUtc(nextRunAt)}::timestamp,
          "lastSlot" = ${toPgTimestampUtc(lastSlot)}::timestamp,
          "updatedAt" = now()
      WHERE "id" = ${id}
        AND "projectId" = ${projectId}
        AND "nextRunAt" = ${toPgTimestampUtc(expectedNextRunAt)}::timestamp
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
    const { count } = await this.prisma.scheduledJob.updateMany({
      where: { projectId, targetType, targetId },
      data: { cron, timezone, nextRunAt, active: true },
    });
    if (count === 0) {
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
             "nextRunAt", "lastSlot", "active", "createdAt", "updatedAt"
      FROM "ScheduledJob"
      ORDER BY "active" DESC, "nextRunAt" ASC
      LIMIT ${limit}
      -- @tenancy: scheduler cross-tenant ops read (system-owned, read-only)
    `;
  }
}

/**
 * No-op `ScheduledJob` repository for the null preset (web boot / tests) where
 * no scheduler runs and there is no `prisma` in scope. Reads return empty,
 * writes are no-ops, and `claim` never wins — nothing fires. Mirrors the
 * sibling `Null*` ops repositories so the null preset never touches Postgres.
 */
export class NullScheduledJobRepository implements ScheduledJobRepository {
  async findDue(): Promise<ScheduledJobRecord[]> {
    return [];
  }
  async earliestActiveNextRunAt(): Promise<Date | null> {
    return null;
  }
  async claim(): Promise<boolean> {
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
}

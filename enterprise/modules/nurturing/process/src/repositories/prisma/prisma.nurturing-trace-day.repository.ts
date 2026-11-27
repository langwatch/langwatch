// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type NurturingTraceDay,
  type NurturingTraceDaySource,
  traceDayOfKey,
} from "../../rules/nurturing-trace-day.rules.ts";
import {
  NURTURING_TRACE_DAY_PROJECTION_VERSION,
  type NurturingTraceDayRepository,
} from "../nurturing-trace-day.repository.ts";

type NurturingTraceDayDatabase = Pick<
  PrismaClient,
  "nurturingProjectTraceDayCount" | "$executeRaw"
>;

type TraceDayRow = Readonly<{
  projectId: string;
  day: string;
  traceCount: number;
  errorCount: number;
  lastTraceAt: Date | null;
  lastFailedTraceAt: Date | null;
}>;

const traceDayOf = (row: TraceDayRow): NurturingTraceDay => ({
  projectId: row.projectId,
  day: row.day,
  traceCount: row.traceCount,
  errorCount: row.errorCount,
  lastTraceAt: row.lastTraceAt?.getTime() ?? null,
  lastFailedTraceAt: row.lastFailedTraceAt?.getTime() ?? null,
});

const dateOf = (at: number | null) => (at === null ? null : new Date(at));

/** Rows one prune statement deletes at most. */
const PRUNE_BATCH_ROWS = 5_000;
/** Statements one sweep's prune runs at most: about a day of rows per hourly sweep keeps up. */
const PRUNE_MAX_BATCHES = 20;

/**
 * A replay folds every span of the log, so a day of only child, sample or Langy spans folds to an
 * empty state; live delivery never stages those, so it keeps no row for that day, and neither does
 * the replay.
 */
const countsAnything = (day: NurturingTraceDay) => day.traceCount > 0 || day.errorCount > 0;

/**
 * The trace-day folds' Postgres rows (`NurturingProjectTraceDayCount`): one per project, UTC day
 * and source, native counts beside the event ids of the last delivery folded in. A row of another
 * projection version reads as undecodable, so the executor throws rather than fold over it, and
 * the organization's read leaves it out.
 */
export class PrismaNurturingTraceDayRepository
  extends PrismaRepository.for("NurturingProjectTraceDayCount")
  implements NurturingTraceDayRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingTraceDayDatabase }>): PrismaNurturingTraceDayRepository {
    return new PrismaNurturingTraceDayRepository(prisma);
  }

  readonly #database: NurturingTraceDayDatabase;

  private constructor(prisma: NurturingTraceDayDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  forSource(source: NurturingTraceDaySource): FoldProjectionStore<NurturingTraceDay> {
    const database = this.#database;
    const getWithApplied = async (
      key: string,
    ): Promise<{
      state: NurturingTraceDay | null;
      appliedEventIds: string[];
      miss?: "absent" | "undecodable";
    }> => {
      const { projectId, day } = traceDayOfKey(key);
      const row = await database.nurturingProjectTraceDayCount.findUnique({
        where: { projectId_day_source: { projectId, day, source } },
      });
      if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
      if (row.projectionVersion !== NURTURING_TRACE_DAY_PROJECTION_VERSION) {
        return { state: null, appliedEventIds: [], miss: "undecodable" };
      }
      return { state: traceDayOf(row), appliedEventIds: row.appliedEventIds };
    };
    return {
      getWithApplied,
      async get(key: string): Promise<FoldStateRead<NurturingTraceDay>> {
        const { state } = await getWithApplied(key);
        return state ? { kind: "folded", state } : { kind: "empty" };
      },
      async store(state: NurturingTraceDay, context: ProjectionStoreContext) {
        if (!countsAnything(state)) return;
        const { projectId, day } = traceDayOfKey(context.key ?? context.aggregateId);
        const columns = {
          traceCount: state.traceCount,
          errorCount: state.errorCount,
          lastTraceAt: dateOf(state.lastTraceAt),
          lastFailedTraceAt: dateOf(state.lastFailedTraceAt),
          appliedEventIds: [...(context.appliedEventIds ?? [])],
          projectionVersion: NURTURING_TRACE_DAY_PROJECTION_VERSION,
        };
        await database.nurturingProjectTraceDayCount.upsert({
          where: { projectId_day_source: { projectId, day, source } },
          create: { projectId, day, source, ...columns },
          update: columns,
        });
      },
    };
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<NurturingTraceDay[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.#database.nurturingProjectTraceDayCount.findMany({
      where: {
        projectId: { in: [...projectIds] },
        day: { gt: afterDay },
        projectionVersion: NURTURING_TRACE_DAY_PROJECTION_VERSION,
      },
    });
    return rows.map(traceDayOf);
  }

  async pruneBefore({
    projectIds,
    beforeDay,
  }: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void> {
    if (projectIds.length === 0) return;
    const where = { projectId: { in: [...projectIds] }, day: { lt: beforeDay } };
    await this.#database.nurturingProjectTraceDayCount.deleteMany({ where });
  }

  /**
   * Deletes in batches so no statement holds row locks the folds' writes would wait on, and stops
   * after a bounded number of them so one sweep cannot run on; the hourly sweep takes the rest.
   */
  async pruneEveryProjectBefore({ beforeDay }: Readonly<{ beforeDay: string }>): Promise<void> {
    for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch++) {
      const deleted = await this.#database.$executeRaw`
        DELETE FROM "NurturingProjectTraceDayCount"
        WHERE ("projectId", "day", "source") IN (
          SELECT "projectId", "day", "source" FROM "NurturingProjectTraceDayCount"
          WHERE "day" < ${beforeDay}
          LIMIT ${PRUNE_BATCH_ROWS}
        )
        ${skipTenantCheck({
          // Nurturing's trace-day retention sweep (system-owned maintenance), across every project
          SKIP_TENANT_CHECK: true,
        })}
      `;
      if (deleted < PRUNE_BATCH_ROWS) return;
    }
  }

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    if (projectIds.length === 0) return;
    const where = { projectId: { in: [...projectIds] } };
    await this.#database.nurturingProjectTraceDayCount.deleteMany({ where });
  }
}

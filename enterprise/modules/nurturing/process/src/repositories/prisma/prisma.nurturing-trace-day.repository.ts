// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import {
  type NurturingTraceDayState,
  nurturingTraceDayStateSchema,
  traceDayOfKey,
} from "../../rules/nurturing-trace-day.rules.ts";
import {
  NURTURING_TRACE_DAY_PROJECTION_VERSION,
  type NurturingTraceDayRepository,
  type NurturingTraceSeeds,
} from "../nurturing-trace-day.repository.ts";

type NurturingTraceDayDatabase = Pick<
  PrismaClient,
  "nurturingProjectTraceDay" | "nurturingProjectTraceSeed"
>;

const seedDaysSchema = z.array(nurturingTraceDayStateSchema);

type AppliedRead = {
  state: NurturingTraceDayState | null;
  appliedEventIds: string[];
  miss?: "absent" | "undecodable";
};

/**
 * The trace-day fold's Postgres rows (`NurturingProjectTraceDay`), one per project and UTC day,
 * and each project's seed from trace's rollup (`NurturingProjectTraceSeed`), one per project. A
 * fold row of another projection version reads as undecodable: every read leaves it out, and the
 * fold, having no re-fold path, throws rather than fold over it.
 */
export class PrismaNurturingTraceDayRepository
  extends PrismaRepository.for("NurturingProjectTraceDay", "NurturingProjectTraceSeed")
  implements NurturingTraceDayRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingTraceDayDatabase }>): PrismaNurturingTraceDayRepository {
    return new PrismaNurturingTraceDayRepository(prisma);
  }

  readonly #database: NurturingTraceDayDatabase;

  readonly store: FoldProjectionStore<NurturingTraceDayState>;

  private constructor(prisma: NurturingTraceDayDatabase) {
    super(prisma);
    this.#database = prisma;
    const getWithApplied = async (key: string): Promise<AppliedRead> => {
      const row = await prisma.nurturingProjectTraceDay.findUnique({
        where: { projectId_day: traceDayOfKey(key) },
      });
      if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
      // Undecodable, not absent: the executor then throws instead of folding onto an empty day.
      if (row.projectionVersion !== NURTURING_TRACE_DAY_PROJECTION_VERSION) {
        return { state: null, appliedEventIds: [], miss: "undecodable" };
      }
      return {
        state: nurturingTraceDayStateSchema.parse(row.folded),
        appliedEventIds: row.appliedEventIds,
      };
    };
    this.store = {
      getWithApplied,
      async get(key: string): Promise<FoldStateRead<NurturingTraceDayState>> {
        const { state } = await getWithApplied(key);
        return state ? { kind: "folded", state } : { kind: "empty" };
      },
      async store(state: NurturingTraceDayState, context: ProjectionStoreContext) {
        const where = traceDayOfKey(context.key ?? context.aggregateId);
        const columns = {
          folded: state,
          appliedEventIds: [...(context.appliedEventIds ?? [])],
          projectionVersion: NURTURING_TRACE_DAY_PROJECTION_VERSION,
          // Business time from the spans, so a replayed row equals the row it rebuilds.
          updatedAt: new Date(state.LastEventOccurredAt),
        };
        await prisma.nurturingProjectTraceDay.upsert({
          where: { projectId_day: where },
          create: { ...where, ...columns },
          update: columns,
        });
      },
    };
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<
    NurturingTraceDayState[]
  > {
    if (projectIds.length === 0) return [];
    const rows = await this.#database.nurturingProjectTraceDay.findMany({
      where: {
        projectId: { in: [...projectIds] },
        day: { gt: afterDay },
        projectionVersion: NURTURING_TRACE_DAY_PROJECTION_VERSION,
      },
    });
    return rows.map((row) => nurturingTraceDayStateSchema.parse(row.folded));
  }

  async pruneBefore({
    projectIds,
    beforeDay,
  }: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void> {
    if (projectIds.length === 0) return;
    await this.#database.nurturingProjectTraceDay.deleteMany({
      where: { projectId: { in: [...projectIds] }, day: { lt: beforeDay } },
    });
  }

  async findSeeds({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<NurturingTraceSeeds> {
    if (projectIds.length === 0) return { seededProjectIds: [], days: [] };
    const rows = await this.#database.nurturingProjectTraceSeed.findMany({
      where: { projectId: { in: [...projectIds] } },
    });
    return {
      seededProjectIds: rows.map((row) => row.projectId),
      days: rows.flatMap((row) =>
        seedDaysSchema.parse(row.days).filter((day) => day.day > afterDay),
      ),
    };
  }

  async recordSeed({
    projectId,
    seededAt,
    days,
  }: Readonly<{
    projectId: string;
    seededAt: number;
    days: readonly NurturingTraceDayState[];
  }>): Promise<void> {
    // The first seed stays: a concurrent second one finds the row and writes nothing.
    await this.#database.nurturingProjectTraceSeed.createMany({
      data: [{ projectId, days: [...days], seededAt: new Date(seededAt) }],
      skipDuplicates: true,
    });
  }
}

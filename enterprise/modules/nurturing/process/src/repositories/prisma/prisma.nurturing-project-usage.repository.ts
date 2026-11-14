// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageState,
  nurturingProjectUsageStateSchema,
} from "../../rules/nurturing-project-usage.rules.ts";
import {
  EVALUATION_ACTIVITY_OWNER,
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
} from "../nurturing-project-usage.repository.ts";

type NurturingProjectUsageDatabase = Pick<PrismaClient, "nurturingProjectUsageView">;

/**
 * The peer folds' Postgres rows (`NurturingProjectUsageView`): one per project and owner, plus the
 * project's evaluation-day row, the folded usage as JSON. A row of another projection version reads
 * as undecodable: the fold has no re-fold path (no refoldOnStoreMiss), so the executor throws
 * rather than fold over it, and the organization's read leaves it out.
 */
export class PrismaNurturingProjectUsageRepository
  extends PrismaRepository.for("NurturingProjectUsageView")
  implements NurturingProjectUsageRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingProjectUsageDatabase }>): PrismaNurturingProjectUsageRepository {
    return new PrismaNurturingProjectUsageRepository(prisma);
  }

  readonly #database: NurturingProjectUsageDatabase;

  private constructor(prisma: NurturingProjectUsageDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  forOwner(owner: NurturingProjectUsageOwner): FoldProjectionStore<NurturingProjectUsageState> {
    const database = this.#database;
    const getWithApplied = async (
      projectId: string,
    ): Promise<{
      state: NurturingProjectUsageState | null;
      appliedEventIds: string[];
      miss?: "absent" | "undecodable";
    }> => {
      const row = await database.nurturingProjectUsageView.findUnique({
        where: { projectId_owner: { projectId, owner } },
      });
      if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
      if (row.projectionVersion !== NURTURING_PROJECT_USAGE_PROJECTION_VERSION) {
        return { state: null, appliedEventIds: [], miss: "undecodable" };
      }
      return {
        state: nurturingProjectUsageStateSchema.parse(row.folded),
        appliedEventIds: row.appliedEventIds,
      };
    };
    return {
      getWithApplied,
      async get(projectId: string): Promise<FoldStateRead<NurturingProjectUsageState>> {
        const { state } = await getWithApplied(projectId);
        return state ? { kind: "folded", state } : { kind: "empty" };
      },
      async store(state: NurturingProjectUsageState, context: ProjectionStoreContext) {
        const projectId = context.key ?? context.aggregateId;
        const columns = {
          folded: state,
          appliedEventIds: [...(context.appliedEventIds ?? [])],
          projectionVersion: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
          // Business time from the facts, so a replayed row equals the row it rebuilds.
          updatedAt: new Date(state.LastEventOccurredAt),
        };
        await database.nurturingProjectUsageView.upsert({
          where: { projectId_owner: { projectId, owner } },
          create: { projectId, owner, ...columns },
          update: columns,
        });
      },
    };
  }

  async recordEvaluationDay({
    projectId,
    occurredAt,
  }: Readonly<{ projectId: string; occurredAt: number }>): Promise<void> {
    const where = { projectId_owner: { projectId, owner: EVALUATION_ACTIVITY_OWNER } };
    const row = await this.#database.nurturingProjectUsageView.findUnique({ where });
    const current =
      row?.projectionVersion === NURTURING_PROJECT_USAGE_PROJECTION_VERSION
        ? nurturingProjectUsageStateSchema.parse(row.folded)
        : emptyProjectUsage(projectId);
    const next = foldProjectUsage(current, { kind: "evaluation_completed", occurredAt });
    if (row && next.activeDays.join() === current.activeDays.join()) return;
    const columns = {
      folded: next,
      appliedEventIds: [],
      projectionVersion: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
      updatedAt: new Date(next.LastEventOccurredAt),
    };
    await this.#database.nurturingProjectUsageView.upsert({
      where,
      create: { projectId, owner: EVALUATION_ACTIVITY_OWNER, ...columns },
      update: columns,
    });
  }

  async findForProjects({
    projectIds,
  }: Readonly<{ projectIds: readonly string[] }>): Promise<NurturingProjectUsageState[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.#database.nurturingProjectUsageView.findMany({
      where: {
        projectId: { in: [...projectIds] },
        projectionVersion: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
      },
    });
    return rows.map((row) => nurturingProjectUsageStateSchema.parse(row.folded));
  }
}

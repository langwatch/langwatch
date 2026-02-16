import { prisma } from "~/server/db";
import type { FoldProjectionStore } from "../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../library/projections/projectionStoreContext";

export interface ProjectDailySdkUsageState {
  projectId: string;
  date: string;
  sdkName: string;
  sdkVersion: string;
  sdkLanguage: string;
  count: number;
  lastEventTimestamp: number | null;
}

/**
 * Postgres-backed store using Prisma upsert.
 *
 * get() always returns null so the fold projection executor calls
 * init() → apply() → store(). The apply function passes through state;
 * the real work happens in store() via the Prisma upsert.
 */
class ProjectDailySdkUsageStore implements FoldProjectionStore<ProjectDailySdkUsageState> {
  async store(
    state: ProjectDailySdkUsageState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id =
      context.key ??
      `${state.projectId}:${state.date}:${state.sdkName}:${state.sdkVersion}:${state.sdkLanguage}`;

    const lastEventTimestamp =
      state.lastEventTimestamp != null
        ? BigInt(state.lastEventTimestamp)
        : null;

    await prisma.projectDailySdkUsage.upsert({
      where: { id, projectId: state.projectId },
      create: {
        id,
        projectId: state.projectId,
        date: state.date,
        sdkName: state.sdkName,
        sdkVersion: state.sdkVersion,
        sdkLanguage: state.sdkLanguage,
        count: 1,
        lastEventTimestamp,
      },
      update: {
        count: { increment: 1 },
        lastEventTimestamp,
      },
    });
  }

  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<ProjectDailySdkUsageState | null> {
    // Always return null — store() handles everything.
    return null;
  }
}

export const projectDailySdkUsageStore = new ProjectDailySdkUsageStore();

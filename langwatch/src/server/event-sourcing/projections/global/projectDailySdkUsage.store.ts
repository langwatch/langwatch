import type { PrismaClient } from "@prisma/client";
import { prisma } from "~/server/db";
import type { FoldProjectionStore } from "../foldProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";

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
export class ProjectDailySdkUsageStore
  implements FoldProjectionStore<ProjectDailySdkUsageState>
{
  constructor(private readonly db: PrismaClient = prisma) {}

  async store(
    state: ProjectDailySdkUsageState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = `${state.projectId}:${state.date}:${state.sdkName}:${state.sdkVersion}:${state.sdkLanguage}`;

    const lastEventTimestamp =
      state.lastEventTimestamp != null
        ? BigInt(state.lastEventTimestamp)
        : null;

    // Live processing: get() returns null → init() (count=0) → apply() once → count=1.
    //   → create inserts count=1, update increments by 1. One event = one increment.
    //
    // Replay (coalesced): multiple apply() calls accumulate → count=N.
    //   → create inserts count=N, update increments by N. One store call for N events.
    await this.db.projectDailySdkUsage.upsert({
      where: { id, projectId: state.projectId },
      create: {
        id,
        projectId: state.projectId,
        date: state.date,
        sdkName: state.sdkName,
        sdkVersion: state.sdkVersion,
        sdkLanguage: state.sdkLanguage,
        count: state.count,
        lastEventTimestamp,
      },
      update: {
        count: { increment: state.count },
        lastEventTimestamp,
      },
    });
  }

  async storeBatch(
    entries: Array<{ state: ProjectDailySdkUsageState; context: ProjectionStoreContext }>,
  ): Promise<void> {
    for (const { state, context } of entries) {
      await this.store(state, context);
    }
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

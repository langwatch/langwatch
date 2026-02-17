import { prisma } from "~/server/db";
import type { FoldProjectionStore } from "../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../library/projections/projectionStoreContext";

export interface ProjectDailyBillableEventsState {
  projectId: string;
  date: string;
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
class ProjectDailyBillableEventsStore
  implements FoldProjectionStore<ProjectDailyBillableEventsState>
{
  async store(
    state: ProjectDailyBillableEventsState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.key ?? `${state.projectId}:${state.date}`;

    const lastEventTimestamp =
      state.lastEventTimestamp != null
        ? BigInt(state.lastEventTimestamp)
        : null;

    await prisma.projectDailyBillableEvents.upsert({
      where: { id, projectId: state.projectId },
      create: {
        id,
        projectId: state.projectId,
        date: state.date,
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
  ): Promise<ProjectDailyBillableEventsState | null> {
    // Always return null — store() handles everything.
    return null;
  }
}

export const projectDailyBillableEventsStore =
  new ProjectDailyBillableEventsStore();

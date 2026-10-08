import type { FoldStateRead } from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import { Temporal, toDate } from "@langwatch/time";

import type {
  DataRetentionProjectScopeRepository,
  DataRetentionProjectScopeState,
} from "../data-retention-project-scope.repository.ts";

function instant(epochMs: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

/**
 * Data retention's fold of where each project sits, over Postgres (`DataRetentionProjectScope`).
 * `updatedAt` holds the newest fact's business time, so a replayed row equals the row it rebuilds.
 */
export class PrismaDataRetentionProjectScopeRepository
  extends PrismaRepository.for("DataRetentionProjectScope")
  implements DataRetentionProjectScopeRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaDataRetentionProjectScopeRepository(prisma),
  );

  async get(aggregateId: string): Promise<FoldStateRead<DataRetentionProjectScopeState>> {
    const row = await this.prisma.dataRetentionProjectScope.findUnique({
      where: { projectId: aggregateId },
    });
    if (!row) return { kind: "empty" };
    return {
      kind: "folded",
      state: {
        projectId: row.projectId,
        organizationId: row.organizationId,
        teamId: row.teamId,
        teamRecordedAt: row.teamRecordedAt?.getTime() ?? null,
        archivedAt: row.archivedAt?.getTime() ?? null,
        LastEventOccurredAt: row.updatedAt.getTime(),
      },
    };
  }

  async store(state: DataRetentionProjectScopeState): Promise<void> {
    const columns = {
      organizationId: state.organizationId,
      teamId: state.teamId,
      teamRecordedAt: state.teamRecordedAt === null ? null : instant(state.teamRecordedAt),
      archivedAt: state.archivedAt === null ? null : instant(state.archivedAt),
      updatedAt: instant(state.LastEventOccurredAt),
    };
    await this.prisma.dataRetentionProjectScope.upsert({
      where: { projectId: state.projectId },
      create: { projectId: state.projectId, ...columns },
      update: columns,
    });
  }

  async findProjectIds({
    organizationId,
    teamId,
  }: {
    organizationId: string;
    teamId?: string;
  }): Promise<string[]> {
    const rows = await this.prisma.dataRetentionProjectScope.findMany({
      where: { organizationId, ...(teamId === undefined ? {} : { teamId }) },
      select: { projectId: true },
    });
    return rows.map((row) => row.projectId);
  }
}

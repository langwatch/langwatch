import { PrismaRepository } from "@langwatch/prisma-client";
import { Temporal, toDate } from "@langwatch/time";

import {
  type DataPrivacyProjectKey,
  type DataPrivacyProjectScope,
  type DataPrivacyProjectScopeRepository,
} from "../data-privacy-project-scope.repository.ts";

function instant(epochMs: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

/** Data privacy's fold of where each project sits, over Postgres; every query names the project. */
export class PrismaDataPrivacyProjectScopeRepository
  extends PrismaRepository.for("DataPrivacyProjectScope")
  implements DataPrivacyProjectScopeRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaDataPrivacyProjectScopeRepository(prisma),
  );

  async find({ projectId }: { projectId: string }): Promise<DataPrivacyProjectScope | null> {
    const row = await this.prisma.dataPrivacyProjectScope.findUnique({
      where: { projectId },
      select: {
        organizationId: true,
        teamId: true,
        isPersonal: true,
        departmentId: true,
        archivedAt: true,
      },
    });
    if (!row) return null;
    return {
      projectId,
      organizationId: row.organizationId,
      teamId: row.teamId,
      isPersonal: row.isPersonal,
      departmentId: row.departmentId,
      archived: row.archivedAt !== null,
    };
  }

  async recordTeam({
    teamId,
    isPersonal,
    recordedAtMs,
    ...key
  }: DataPrivacyProjectKey & {
    teamId: string;
    isPersonal?: boolean;
    recordedAtMs: number;
  }): Promise<void> {
    await this.#ensure(key);
    const recordedAt = instant(recordedAtMs);
    if (isPersonal !== undefined) {
      await this.prisma.dataPrivacyProjectScope.updateMany({
        where: { projectId: key.projectId },
        data: { isPersonal },
      });
    }
    await this.prisma.dataPrivacyProjectScope.updateMany({
      where: {
        projectId: key.projectId,
        OR: [{ teamRecordedAt: null }, { teamRecordedAt: { lt: recordedAt } }],
      },
      data: { teamId, teamRecordedAt: recordedAt },
    });
  }

  async recordDepartment({
    departmentId,
    recordedAtMs,
    ...key
  }: DataPrivacyProjectKey & { departmentId: string | null; recordedAtMs: number }): Promise<void> {
    await this.#ensure(key);
    const recordedAt = instant(recordedAtMs);
    await this.prisma.dataPrivacyProjectScope.updateMany({
      where: {
        projectId: key.projectId,
        OR: [{ departmentRecordedAt: null }, { departmentRecordedAt: { lt: recordedAt } }],
      },
      data: { departmentId, departmentRecordedAt: recordedAt },
    });
  }

  async recordArchived({
    archivedAtMs,
    ...key
  }: DataPrivacyProjectKey & { archivedAtMs: number }): Promise<void> {
    await this.#ensure(key);
    await this.prisma.dataPrivacyProjectScope.updateMany({
      where: { projectId: key.projectId, archivedAt: null },
      data: { archivedAt: instant(archivedAtMs) },
    });
  }

  /** Creates the row once; a concurrent fold's row stands (ON CONFLICT DO NOTHING). */
  async #ensure({ projectId, organizationId }: DataPrivacyProjectKey): Promise<void> {
    await this.prisma.dataPrivacyProjectScope.createMany({
      data: [{ projectId, organizationId }],
      skipDuplicates: true,
    });
  }
}

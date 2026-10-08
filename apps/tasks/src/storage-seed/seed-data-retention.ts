import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, toDate } from "@langwatch/time";

type SeededProject = Readonly<{ id: string; organizationId: string; teamId: string }>;

/**
 * Data retention's scope row for the project the seed writes directly, which records no lifecycle
 * fact to fold; without it every trace projection refuses with project_not_found. No fact time
 * (epoch zero), so a real fact still folds over it. Precedent: seed-data-privacy.ts.
 */
export function dataRetentionScopeRowFor({
  project,
}: {
  project: SeededProject;
}): Prisma.DataRetentionProjectScopeUncheckedCreateInput {
  return {
    projectId: project.id,
    organizationId: project.organizationId,
    teamId: project.teamId,
    updatedAt: toDate(Temporal.Instant.fromEpochMilliseconds(0)),
  };
}

/** Creates the seeded project's scope row once; a row the fold already wrote stands. */
export async function seedDataRetentionProjectScope({
  prisma,
  project,
}: {
  prisma: PrismaClient;
  project: SeededProject;
}): Promise<void> {
  await prisma.dataRetentionProjectScope.createMany({
    data: [dataRetentionScopeRowFor({ project })],
    skipDuplicates: true,
  });
}

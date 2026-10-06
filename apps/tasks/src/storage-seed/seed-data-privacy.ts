import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

type SeededProject = Readonly<{
  id: string;
  organizationId: string;
  teamId: string;
  departmentId: string | null;
  isPersonal: boolean;
}>;

/**
 * Data privacy's scope row for a project the seed writes directly, which records no lifecycle
 * fact to fold. Without it every read of the project fails closed as not found. No fact time
 * is set, so a real fact still folds over the row. Spec: specs/setup/haven-seed-presets.feature
 */
export function dataPrivacyScopeRowFor({
  project,
}: {
  project: SeededProject;
}): Prisma.DataPrivacyProjectScopeUncheckedCreateInput {
  return {
    projectId: project.id,
    organizationId: project.organizationId,
    teamId: project.teamId,
    departmentId: project.departmentId,
    isPersonal: project.isPersonal,
  };
}

/** Creates the seeded project's scope row once; a row the fold already wrote stands. */
export async function seedDataPrivacyProjectScope({
  prisma,
  project,
}: {
  prisma: PrismaClient;
  project: SeededProject;
}): Promise<void> {
  await prisma.dataPrivacyProjectScope.createMany({
    data: [dataPrivacyScopeRowFor({ project })],
    skipDuplicates: true,
  });
}

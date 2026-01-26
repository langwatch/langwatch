import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

/**
 * Gets the organizationId for a project.
 * Used for license enforcement checks.
 *
 * @param prisma - Prisma client instance
 * @param projectId - The project ID to look up
 * @returns The organizationId for the project
 * @throws TRPCError with NOT_FOUND code if project doesn't exist or has no organization
 */
export async function getOrganizationIdForProject(
  prisma: PrismaClient,
  projectId: string,
): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: true },
  });

  if (!project?.team?.organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }

  return project.team.organizationId;
}

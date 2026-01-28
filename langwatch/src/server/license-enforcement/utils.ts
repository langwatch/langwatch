import type { PrismaClient } from "@prisma/client";
import { ProjectNotFoundError } from "./errors";

/**
 * Gets the organizationId for a project.
 * Used for license enforcement checks.
 *
 * @param prisma - Prisma client instance
 * @param projectId - The project ID to look up
 * @returns The organizationId for the project
 * @throws ProjectNotFoundError if project doesn't exist or has no organization
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
    throw new ProjectNotFoundError(projectId);
  }

  return project.team.organizationId;
}

import type { PrismaClient } from "@prisma/client";

export async function dashboardBelongsToProject(
  prisma: PrismaClient,
  dashboardId: string,
  projectId: string,
): Promise<boolean> {
  const dashboard = await prisma.dashboard.findFirst({
    where: { id: dashboardId, projectId },
    select: { id: true },
  });
  return dashboard !== null;
}

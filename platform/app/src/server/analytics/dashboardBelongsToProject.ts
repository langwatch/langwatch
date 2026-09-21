import type { Prisma, PrismaClient } from "~/generated/prisma/client";

export async function dashboardBelongsToProject(
  prisma: PrismaClient | Prisma.TransactionClient,
  dashboardId: string,
  projectId: string,
): Promise<boolean> {
  const dashboard = await prisma.dashboard.findFirst({
    where: { id: dashboardId, projectId },
    select: { id: true },
  });
  return dashboard !== null;
}

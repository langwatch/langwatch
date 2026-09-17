import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Whether a dashboard row with this id belongs to this project. A plain
 * existence check against the `dashboard` table, so it runs equally well
 * inside the transaction a caller is already scoping its writes to.
 */
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

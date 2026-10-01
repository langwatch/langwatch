import { PrismaRepository } from "@langwatch/prisma-client";

/** Reads ownership inside the same transaction as the placement write. */
export class PrismaDashboardOwnershipRepository extends PrismaRepository.for("Dashboard") {
  static readonly create = this.factory((prisma) => new PrismaDashboardOwnershipRepository(prisma));

  async belongsToProject(input: { dashboardId: string; projectId: string }): Promise<boolean> {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id: input.dashboardId, projectId: input.projectId },
      select: { id: true },
    });
    return dashboard !== null;
  }
}

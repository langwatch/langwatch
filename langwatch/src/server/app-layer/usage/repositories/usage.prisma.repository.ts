import type { PrismaClient } from "@prisma/client";
import type {
  BillableEventsAggregate,
  UsageRepository,
} from "./usage.repository";

export class PrismaUsageRepository implements UsageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async sumBillableEvents({
    projectIds,
    fromDate,
  }: {
    projectIds: string[];
    fromDate: string;
  }): Promise<number> {
    const result = await this.prisma.projectDailyBillableEvents.aggregate({
      where: {
        projectId: { in: projectIds },
        date: { gte: fromDate },
      },
      _sum: { count: true },
    });
    return result._sum.count ?? 0;
  }

  async groupBillableEventsByProject({
    projectIds,
    fromDate,
  }: {
    projectIds: string[];
    fromDate: string;
  }): Promise<BillableEventsAggregate[]> {
    const groups = await this.prisma.projectDailyBillableEvents.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        date: { gte: fromDate },
      },
      _sum: { count: true },
    });

    const countMap = new Map(
      groups.map((g) => [g.projectId, g._sum.count ?? 0]),
    );

    return projectIds.map((id) => ({
      projectId: id,
      count: countMap.get(id) ?? 0,
    }));
  }
}

import type { CustomGraph, PrismaClient } from "@prisma/client";
import type {
  AutomationCustomGraphRepository,
  CustomGraphNameRef,
} from "./custom-graph.repository";

export class PrismaAutomationCustomGraphRepository
  implements AutomationCustomGraphRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findById({
    customGraphId,
    projectId,
  }: {
    customGraphId: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    return this.prisma.customGraph.findUnique({
      where: { id: customGraphId, projectId },
    });
  }

  async existsInProject({
    customGraphId,
    projectId,
  }: {
    customGraphId: string;
    projectId: string;
  }): Promise<boolean> {
    const row = await this.prisma.customGraph.findUnique({
      where: { id: customGraphId, projectId },
      select: { id: true },
    });
    return row !== null;
  }

  async findAllNamesByIds({
    customGraphIds,
    projectId,
  }: {
    customGraphIds: string[];
    projectId: string;
  }): Promise<CustomGraphNameRef[]> {
    return this.prisma.customGraph.findMany({
      where: { id: { in: customGraphIds }, projectId },
      select: { id: true, name: true },
    });
  }
}

import { EvaluationExecutionMode, type PrismaClient } from "@prisma/client";
import type { MonitorRepository, MonitorSummary } from "./monitor.repository";

export class PrismaMonitorRepository implements MonitorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.prisma.monitor.findMany({
      where: {
        projectId,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
      },
      select: {
        id: true,
        checkType: true,
        name: true,
        sample: true,
        threadIdleTimeout: true,
      },
    });
  }
}

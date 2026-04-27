import { EvaluationExecutionMode, type PrismaClient } from "@prisma/client";
import type { MonitorRepository, MonitorSummary, MonitorWithEvaluator } from "./monitor.repository";

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
        threadIdleTimeout: true,
      },
    });
  }

  async getMonitorById({ projectId, monitorId }: { projectId: string; monitorId: string }): Promise<MonitorWithEvaluator | null> {
    return this.prisma.monitor.findUnique({
      where: { id: monitorId, projectId },
      select: {
        id: true,
        checkType: true,
        sample: true,
        preconditions: true,
        parameters: true,
        mappings: true,
        level: true,
        evaluator: {
          select: {
            config: true,
            type: true,
            workflowId: true,
          },
        },
      },
    });
  }
}

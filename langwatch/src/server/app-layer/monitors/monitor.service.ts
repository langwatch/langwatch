import type { PrismaClient } from "@prisma/client";
import { traced } from "../tracing";
import { PrismaMonitorRepository } from "./repositories/monitor.prisma.repository";
import {
  NullMonitorRepository,
  type MonitorRepository,
  type MonitorSummary,
} from "./repositories/monitor.repository";

export class MonitorService {
  private constructor(private readonly repo: MonitorRepository) {}

  static create(prisma: PrismaClient | null): MonitorService {
    const repo = prisma
      ? new PrismaMonitorRepository(prisma)
      : new NullMonitorRepository();
    return traced(new MonitorService(repo), "MonitorService");
  }

  async getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.repo.getEnabledOnMessageMonitors(projectId);
  }
}

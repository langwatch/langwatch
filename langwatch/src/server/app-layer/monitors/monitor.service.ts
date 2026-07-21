import type { Monitor, PrismaClient } from "@prisma/client";
import { PrismaMonitorRepository } from "./repositories/monitor.prisma.repository";
import type {
  MonitorRepository,
  MonitorSummary,
  MonitorWithEvaluator,
} from "./repositories/monitor.repository";

export class MonitorService {
  constructor(private readonly repo: MonitorRepository) {}

  /** Per-request factory for callers outside the App wiring (tRPC routers). */
  static create(prisma: PrismaClient): MonitorService {
    return new MonitorService(new PrismaMonitorRepository(prisma));
  }

  async getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.repo.getEnabledOnMessageMonitors(projectId);
  }

  async getMonitorById(params: { projectId: string; monitorId: string }): Promise<MonitorWithEvaluator | null> {
    return this.repo.getMonitorById(params);
  }

  /** Full monitor rows for the given ids, scoped to the project. */
  async getAllByIds(params: {
    monitorIds: string[];
    projectId: string;
  }): Promise<Monitor[]> {
    return this.repo.findAllByIds(params);
  }
}

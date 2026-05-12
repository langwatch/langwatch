import type {
  MonitorRepository,
  MonitorSummary,
  MonitorWithEvaluator,
} from "./repositories/monitor.repository";

export class MonitorService {
  constructor(private readonly repo: MonitorRepository) {}

  async getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.repo.getEnabledOnMessageMonitors(projectId);
  }

  async getMonitorById(params: { projectId: string; monitorId: string }): Promise<MonitorWithEvaluator | null> {
    return this.repo.getMonitorById(params);
  }
}

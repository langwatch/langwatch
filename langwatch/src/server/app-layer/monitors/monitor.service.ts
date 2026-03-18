import type {
  MonitorRepository,
  MonitorSummary,
} from "./repositories/monitor.repository";

export class MonitorService {
  constructor(private readonly repo: MonitorRepository) {}

  async getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.repo.getEnabledOnMessageMonitors(projectId);
  }
}

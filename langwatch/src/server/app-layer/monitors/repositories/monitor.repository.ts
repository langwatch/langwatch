export interface MonitorSummary {
  id: string;
  checkType: string;
  name: string;
}

export interface MonitorRepository {
  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]>;
}

export class NullMonitorRepository implements MonitorRepository {
  async getEnabledOnMessageMonitors(_projectId: string): Promise<MonitorSummary[]> {
    return [];
  }
}

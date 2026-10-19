import type { MonitorSummary } from "@langwatch/monitor-contract";

import type { MonitorRepository } from "../repositories/monitor.repository.ts";

/**
 * The monitor listing that trace ingestion reads; a simple repository read for
 * enabled monitors.
 */
export class MonitorCatalogService {
  private constructor(private readonly repository: MonitorRepository) {}

  static create(options: { repository: MonitorRepository }): MonitorCatalogService {
    return new MonitorCatalogService(options.repository);
  }

  getEnabledOnMessageMonitors(projectId: string): Promise<MonitorSummary[]> {
    return this.repository.findEnabledOnMessage(projectId);
  }
}

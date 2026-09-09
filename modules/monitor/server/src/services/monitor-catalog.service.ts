import type { MonitorSummary } from "@langwatch/monitor-contract";
import type { MonitorRepository } from "../repositories/monitor.repository.ts";

/**
 * The monitor listing that trace ingestion reads.
 *
 * One operation, on the repository alone. The evaluation trigger asks, once
 * per trace, which of a project's monitors are enabled to run on every
 * message, and that is the whole of its dependency on this feature —
 * {@link MonitorService} reaches the evaluator and an id generator because
 * creating, updating and replicating a monitor resolves the evaluator behind
 * it and mints ids, and this read reaches neither.
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

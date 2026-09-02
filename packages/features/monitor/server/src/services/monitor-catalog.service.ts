import type { MonitorSummary } from "@langwatch/monitor-contract";
import type { MonitorRepository } from "../repositories/monitor.repository";

/**
 * The monitor listing that trace ingestion reads.
 *
 * One operation, on the repository alone. It was a method of `MonitorService`,
 * which still answers it — it composes this and delegates, so there is one
 * implementation and no twin to drift — but a process that only ingests can
 * now compose it WITHOUT the rest of the feature.
 *
 * The distinction is a real one. `MonitorService` requires an
 * `EvaluatorService` and an id generator because creating, replicating and
 * updating a monitor all resolve the evaluator behind it and mint ids. The
 * listing below reaches neither: it answers which of a project's monitors are
 * enabled to run on every message, which is the question the evaluation
 * trigger asks once per trace and the only question it asks.
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

import type { EvaluationClickHouseResolver } from "../ports/evaluation.port";
import { ClickHouseMonitorPerformanceRepository } from "../repositories/clickhouse/monitor-performance.repository";
import { MonitorPerformanceService } from "../services/monitor-performance.service";

/**
 * Composes the trend read alone, over a routed ClickHouse.
 *
 * The counterpart to {@link EvaluationAdapter} for a process that reads the
 * monitors page and executes nothing: the repository stays private to this
 * package, and what a caller receives is the service that folds its buckets.
 */
export class MonitorPerformanceAdapter {
  static create(options: {
    resolveClickHouse: EvaluationClickHouseResolver;
  }): MonitorPerformanceService {
    return MonitorPerformanceService.create({
      repository: ClickHouseMonitorPerformanceRepository.create({
        resolveClient: options.resolveClickHouse,
      }),
    });
  }
}

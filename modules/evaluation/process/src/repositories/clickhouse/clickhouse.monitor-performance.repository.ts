import type { EvaluationClickHouseResolver } from "./evaluation-clickhouse-client.ts";
import { ClickHouseMonitorPerformanceRepository } from "./monitor-performance.repository.ts";
import { MonitorPerformanceService } from "../../services/monitor-performance.service.ts";

/**
 * Composes the trend read alone, over a routed ClickHouse. The counterpart
 * to {@link EvaluationAdapter} for a process that reads the monitors page and
 * executes nothing — the repository stays private; callers get the folding service.
 */
export class ClickhouseMonitorPerformanceRepository {
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

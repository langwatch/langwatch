/**
 * Process composition binds the one filter-option repository to its service.
 */
import type { EvaluationAnalyticsClickHouseClient } from "../repositories/clickhouse/clickhouse.analytics-persistence.repository.ts";
import { FilterOptionsClickHouseRepository } from "../repositories/clickhouse/clickhouse.filter-options.repository.ts";
import { FilterService } from "../services/filter.service.ts";

export class FilterOptionsAdapter {
  static create(options: {
    resolveClient: ((tenantId: string) => Promise<EvaluationAnalyticsClickHouseClient>) | null;
  }): FilterService {
    return FilterService.create({
      repository: options.resolveClient
        ? FilterOptionsClickHouseRepository.create({ resolveClient: options.resolveClient })
        : null,
    });
  }
}

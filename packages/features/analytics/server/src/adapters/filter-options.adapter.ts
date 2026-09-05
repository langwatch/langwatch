/**
 * Process composition binds the one filter-option repository to its service.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { FilterOptionsClickHouseRepository } from "../repositories/clickhouse/clickhouse.filter-options.repository";
import { FilterService } from "../services/filter.service";

export class FilterOptionsAdapter {
  static create(options: {
    resolveClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  }): FilterService {
    return FilterService.create({
      repository: options.resolveClient
        ? FilterOptionsClickHouseRepository.create({ resolveClient: options.resolveClient })
        : null,
    });
  }
}

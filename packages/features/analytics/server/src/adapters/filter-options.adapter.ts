/**
 * Process composition binds the one filter-option repository to its service.
 *
 * `null` is a real deployment shape rather than a fault: a process without
 * ClickHouse can still compose the analytics application, and the filter
 * picker refuses at the call with the message it always had — see
 * {@link FilterService}.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { FilterOptionsClickHouseRepository } from "../repositories/clickhouse/clickhouse.filter-options.repository";
import { FilterService } from "../services/filter.service";

export class FilterOptionsAdapter {
  static create(options: {
    resolveClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  }): FilterService {
    return new FilterService(
      options.resolveClient
        ? new FilterOptionsClickHouseRepository(options.resolveClient)
        : null,
    );
  }
}

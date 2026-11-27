import {
  CLICKHOUSE_QUERY_ERROR_MAX_PROJECTS,
  type ClickHouseQueryErrorGroup,
  type ClickHouseQueryErrorsInput,
  type ClickHouseServerHealth,
} from "@langwatch/ops-contract";

import type { ClickHouseServerRepository } from "../repositories/clickhouse.server.repository.ts";
import { projectIdsOf, querySourceOf } from "../rules/clickhouse-query-source.rules.ts";

/**
 * The shared ClickHouse's failed statements and health for ops functions (ADR-202): read across
 * the configured cluster, with every source this release does not know collapsed to `other`.
 */
export class ClickHouseServerReadService {
  private constructor(
    private readonly repository: ClickHouseServerRepository,
    private readonly cluster: string | undefined,
  ) {}

  static create({
    repository,
    cluster,
  }: {
    repository: ClickHouseServerRepository;
    cluster?: string | undefined;
  }): ClickHouseServerReadService {
    return new ClickHouseServerReadService(repository, cluster);
  }

  async findQueryErrors(input: ClickHouseQueryErrorsInput): Promise<ClickHouseQueryErrorGroup[]> {
    if (input.untilMs <= input.sinceMs) return [];
    const rows = await this.repository.findQueryErrors({ ...input, cluster: this.cluster });
    return rows.map((row) => ({
      ...row,
      source: querySourceOf(row.source),
      projectIds: projectIdsOf({ ids: row.projectIds, max: CLICKHOUSE_QUERY_ERROR_MAX_PROJECTS }),
    }));
  }

  getHealth(): Promise<ClickHouseServerHealth> {
    return this.repository.findHealth({ cluster: this.cluster });
  }
}

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type {
  SuiteEventingCapabilities,
  SuiteEventingRepository,
} from "../suite-eventing.repository.ts";
import { ClickHouseSuiteRunRepository } from "./clickhouse.suite-run.repository.ts";

export type ClickHouseSuiteEventingRepositoryOptions = {
  /** The process's one ClickHouse client, which routes each statement itself. */
  clickhouse: ClickHouseQueryClient;
  defaultRetentionDays: () => number;
};

/** Builds Suite's ClickHouse projection capability for replay processes. */
export class ClickhouseSuiteEventingRepository implements SuiteEventingRepository {
  static create(
    options: ClickHouseSuiteEventingRepositoryOptions,
  ): ClickhouseSuiteEventingRepository {
    return new ClickhouseSuiteEventingRepository(options);
  }

  private constructor(private readonly options: ClickHouseSuiteEventingRepositoryOptions) {}

  build(): SuiteEventingCapabilities {
    return {
      suiteRunState: ClickHouseSuiteRunRepository.create({
        clickhouse: this.options.clickhouse,
        defaultRetentionDays: this.options.defaultRetentionDays,
      }),
    };
  }
}

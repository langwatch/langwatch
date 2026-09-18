import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { SuiteEventingCapabilities } from "../suite-eventing.repository.ts";
import { ClickHouseSuiteRunRepository } from "./clickhouse.suite-run.repository.ts";

export type ClickHouseSuiteEventingAdapterOptions = {
  /** The process's one ClickHouse client, which routes each statement itself. */
  clickhouse: ClickHouseQueryClient;
  defaultRetentionDays: number;
};

/** Builds Suite's ClickHouse projection capability for replay processes. */
export class ClickhouseSuiteEventingRepository {
  static create(options: ClickHouseSuiteEventingAdapterOptions): ClickhouseSuiteEventingRepository {
    return new ClickhouseSuiteEventingRepository(options);
  }

  private constructor(private readonly options: ClickHouseSuiteEventingAdapterOptions) {}

  build(): SuiteEventingCapabilities {
    return {
      suiteRunState: ClickHouseSuiteRunRepository.create({
        clickhouse: this.options.clickhouse,
        defaultRetentionDays: this.options.defaultRetentionDays,
      }),
    };
  }
}

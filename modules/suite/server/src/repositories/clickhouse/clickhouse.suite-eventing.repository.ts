import type { SuiteEventingCapabilities } from "../../ports/suite-runtime.port.ts";
import type { SuiteClickHouseClient } from "../../ports/suite-clickhouse.port.ts";
import { ClickHouseSuiteRunRepository } from "./clickhouse.suite-run.repository.ts";

export type ClickHouseSuiteEventingAdapterOptions = {
  resolveClient: (projectId: string) => Promise<SuiteClickHouseClient>;
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
        resolveClient: this.options.resolveClient,
        defaultRetentionDays: this.options.defaultRetentionDays,
      }),
    };
  }
}

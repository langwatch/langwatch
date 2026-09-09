import type { SuiteEventingCapabilities } from "../ports/suite-runtime.port.ts";
import type { SuiteClickHouseClient } from "../ports/suite-clickhouse.port.ts";
import { ClickHouseSuiteRunRepository } from "../repositories/clickhouse/clickhouse.suite-run.repository.ts";

export type ClickHouseSuiteEventingAdapterOptions = {
  resolveClient: (projectId: string) => Promise<SuiteClickHouseClient>;
  defaultRetentionDays: number;
};

/** Builds Suite's ClickHouse projection capability for replay processes. */
export class ClickHouseSuiteEventingAdapter {
  static create(options: ClickHouseSuiteEventingAdapterOptions): ClickHouseSuiteEventingAdapter {
    return new ClickHouseSuiteEventingAdapter(options);
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

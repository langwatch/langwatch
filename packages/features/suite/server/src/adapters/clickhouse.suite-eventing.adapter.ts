import type { SuiteEventingCapabilities } from "./suite-runtime.adapter";
import type { SuiteClickHouseClient } from "../ports/suite-clickhouse.port";
import { ClickHouseSuiteRunRepository } from "../repositories/clickhouse/clickhouse.suite-run.repository";

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

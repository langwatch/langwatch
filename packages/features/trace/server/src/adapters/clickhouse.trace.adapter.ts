import type { TraceService as TraceServiceContract } from "@langwatch/trace-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";

import type { TraceClickHouseResolver } from "./clickhouse.types";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/clickhouse.trace-span.repository";
import { TraceService } from "../services/trace.service";

export type ClickHouseTraceAdapterOptions = {
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderService;
};

/** Composes concrete ClickHouse repositories without exposing private ports. */
export class ClickHouseTraceAdapter {
  private constructor(private readonly options: ClickHouseTraceAdapterOptions) {}

  static create(options: ClickHouseTraceAdapterOptions): ClickHouseTraceAdapter {
    return new ClickHouseTraceAdapter(options);
  }

  build(): TraceServiceContract {
    return TraceService.create({
      repository: ClickHouseTraceSpanRepository.create(
        this.options.resolveClient,
      ),
      modelProviders: this.options.modelProviders,
    });
  }
}

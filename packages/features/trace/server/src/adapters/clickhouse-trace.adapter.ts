import type { TraceService as TraceServiceContract } from "@langwatch/trace-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";

import {
  TraceClickHousePort,
  type TraceClickHouseResolver,
} from "../ports/clickhouse.port";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/trace-span.repository";
import { TraceQueryFieldValuesPort } from "../ports/query-field-values.port";
import { NullQueryFieldValuesAdapter } from "./null-query-field-values.adapter";
import {
  TraceRepository,
  type TraceSpanPage,
  type TraceSpanSummaryRecord,
} from "../ports/trace.port";
import { TraceService } from "../services/trace.service";

export type ClickHouseTraceAdapterOptions = {
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderService;
  queryFieldValues: TraceQueryFieldValuesPort;
};

/** Composes the Trace service from its ClickHouse and query-value boundaries. */
export class ClickHouseTraceAdapter {
  private constructor(private readonly options: ClickHouseTraceAdapterOptions) {}

  static create(options: ClickHouseTraceAdapterOptions): ClickHouseTraceAdapter {
    return new ClickHouseTraceAdapter(options);
  }

  /** Default API and test composition use this when ClickHouse is disabled. */
  static createNull(modelProviders: ModelProviderService): TraceServiceContract {
    return TraceService.create({
      repository: new NullTraceRepository(),
      modelProviders,
      queryFieldValues: NullQueryFieldValuesAdapter.create(),
    });
  }

  build(): TraceServiceContract {
    return TraceService.create({
      repository: ClickHouseTraceSpanRepository.create(
        ResolverTraceClickHousePort.create(this.options.resolveClient),
      ),
      modelProviders: this.options.modelProviders,
      queryFieldValues: this.options.queryFieldValues,
    });
  }
}

class ResolverTraceClickHousePort extends TraceClickHousePort {
  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  static create(resolveClient: TraceClickHouseResolver): ResolverTraceClickHousePort {
    return new ResolverTraceClickHousePort(resolveClient);
  }

  resolve(tenantId: string) {
    return this.resolveClient(tenantId);
  }
}

class NullTraceRepository extends TraceRepository {
  async findSummaryPage(): Promise<TraceSpanPage> {
    return { rows: [], hasMore: false };
  }

  async findSummarySince(): Promise<TraceSpanSummaryRecord[]> {
    return [];
  }
}

import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
  type TraceFullReadInput,
} from "@langwatch/trace-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import { TraceClickHousePort, type TraceClickHouseResolver } from "../ports/clickhouse.port.ts";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/trace-span.repository.ts";
import { TraceQueryFieldValuesPort } from "../ports/query-field-values.port.ts";
import { TraceQueryClassificationPort } from "../ports/trace-query-classification.port.ts";
import { TraceSummaryReaderPort } from "../ports/trace-summary-reader.port.ts";
import { TraceRecordPort } from "../ports/trace-record.port.ts";
import { TraceEventDerivationPort } from "../ports/trace-event-derivation.port.ts";
import { TraceFullRecordPort } from "../ports/trace-full-record.port.ts";
import { TracePayloadReaderPort } from "../ports/trace-payload-reader.port.ts";
import { TraceFullIoPort } from "../ports/trace-full-io.port.ts";
import { ClickHouseTraceFullRecordRepository } from "../repositories/clickhouse/trace-full-record.repository.ts";
import { NullQueryFieldValuesAdapter } from "../repositories/memory/null-query-field-values.adapter.ts";
import { TracePort, type TraceSpanPage, type TraceSpanSummaryRecord } from "../ports/trace.port.ts";
import { TraceService } from "../services/trace.service.ts";

export type ClickHouseTraceAdapterOptions = {
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderApi;
  queryFieldValues: TraceQueryFieldValuesPort;
  queryClassification?: TraceQueryClassificationPort;
  summaryReader?: TraceSummaryReaderPort;
  records?: TraceRecordPort;
  eventDerivation?: TraceEventDerivationPort;
  payloads: TracePayloadReaderPort;
  fullIo: TraceFullIoPort;
};

/** Composes the Trace service from its ClickHouse and query-value boundaries. */
export class ClickHouseTraceAdapter {
  private constructor(private readonly options: ClickHouseTraceAdapterOptions) {}

  static create(options: ClickHouseTraceAdapterOptions): ClickHouseTraceAdapter {
    return new ClickHouseTraceAdapter(options);
  }

  /** Default API and test composition use this when ClickHouse is disabled. */
  static createNull(modelProviders: ModelProviderApi): TraceService {
    return TraceService.create({
      repository: new NullTraceRepository(),
      modelProviders,
      queryFieldValues: NullQueryFieldValuesAdapter.create(),
      queryClassification: NullTraceQueryClassificationAdapter.create(),
      summaryReader: new NullTraceSummaryReader(),
      records: new NullTraceRecordPort(),
      eventDerivation: new NullTraceEventDerivationPort(),
      fullRecords: new NullTraceFullRecordPort(),
    });
  }

  build(): TraceService {
    const clickhouse = ResolverTraceClickHousePort.create(this.options.resolveClient);
    return TraceService.create({
      repository: ClickHouseTraceSpanRepository.create(clickhouse),
      modelProviders: this.options.modelProviders,
      queryFieldValues: this.options.queryFieldValues,
      queryClassification:
        this.options.queryClassification ?? NullTraceQueryClassificationAdapter.create(),
      summaryReader: this.options.summaryReader ?? new NullTraceSummaryReader(),
      records: this.options.records ?? new NullTraceRecordPort(),
      eventDerivation: this.options.eventDerivation ?? new NullTraceEventDerivationPort(),
      fullRecords: ClickHouseTraceFullRecordRepository.create(
        clickhouse,
        this.options.payloads,
        this.options.fullIo,
      ),
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

class NullTraceRepository extends TracePort {
  async findEvaluationSpans(): Promise<[]> {
    return [];
  }

  async findEvaluationEvents(): Promise<[]> {
    return [];
  }

  async tryFindIngestLag(): Promise<null> {
    return null;
  }

  async findSummaryPage(): Promise<TraceSpanPage> {
    return { rows: [], hasMore: false };
  }

  async findSummarySince(): Promise<TraceSpanSummaryRecord[]> {
    return [];
  }
}

class NullTraceSummaryReader extends TraceSummaryReaderPort {
  async tryGetSummary(): Promise<null> {
    return null;
  }
}

class NullTraceRecordPort extends TraceRecordPort {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

class NullTraceEventDerivationPort extends TraceEventDerivationPort {
  async derive(_input: TraceDerivedEventsInput): Promise<[]> {
    return [];
  }
}

class NullTraceFullRecordPort extends TraceFullRecordPort {
  async get(input: TraceFullReadInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }

  async getThread(): Promise<[]> {
    return [];
  }
}

class NullTraceQueryClassificationAdapter extends TraceQueryClassificationPort {
  private constructor() {
    super();
  }

  static create(): NullTraceQueryClassificationAdapter {
    return new NullTraceQueryClassificationAdapter();
  }

  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}

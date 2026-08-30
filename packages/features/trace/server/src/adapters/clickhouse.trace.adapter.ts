import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
  type TraceFullReadInput,
  type TraceService as TraceServiceContract,
} from "@langwatch/trace-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";

import { TraceClickHousePort, type TraceClickHouseResolver } from "../ports/clickhouse.port";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/trace-span.repository";
import { TraceQueryFieldValuesPort } from "../ports/query-field-values.port";
import { TraceQueryClassificationPort } from "../ports/trace-query-classification.port";
import { TraceSummaryReaderPort } from "../ports/trace-summary-reader.port";
import { TraceRecordPort } from "../ports/trace-record.port";
import { TraceEventDerivationPort } from "../ports/trace-event-derivation.port";
import { TraceFullRecordPort } from "../ports/trace-full-record.port";
import { TracePayloadReaderPort } from "../ports/trace-payload-reader.port";
import { TraceFullIoPort } from "../ports/trace-full-io.port";
import { ClickHouseTraceFullRecordRepository } from "../repositories/clickhouse/trace-full-record.repository";
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
  static createNull(modelProviders: ModelProviderService): TraceServiceContract {
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

  build(): TraceServiceContract {
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

class NullTraceRepository extends TraceRepository {
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

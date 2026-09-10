import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
} from "@langwatch/trace-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

import { TraceClickHouse, type TraceClickHouseResolver } from "../repositories/trace-clickhouse-client.repository.ts";
import { ClickHouseTraceSpanRepository } from "../repositories/clickhouse/trace-span.repository.ts";
import { TraceQueryFieldValuesRepository } from "../repositories/read/query-field-values.repository.ts";
import { TraceQueryClassifier } from "./trace.members.ts";
import { TraceSummaryReaderRepository } from "../repositories/read/trace-summary-reader.repository.ts";
import { TraceRecordRepository } from "../repositories/read/trace-record.repository.ts";
import { TraceEventDerivation } from "./trace.members.ts";
import { TracePayloadReaderRepository } from "../repositories/read/trace-payload-reader.repository.ts";
import { TraceFullIo } from "./trace.members.ts";
import { ClickHouseTraceFullRecordRepository } from "../repositories/clickhouse/trace-full-record.repository.ts";
import { TraceService } from "../services/support/trace.service.ts";

export type TraceTreeCompositionOptions = {
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderApi;
  queryFieldValues: TraceQueryFieldValuesRepository;
  queryClassification?: TraceQueryClassifier;
  summaryReader?: TraceSummaryReaderRepository;
  records?: TraceRecordRepository;
  eventDerivation?: TraceEventDerivation;
  payloads: TracePayloadReaderRepository;
  fullIo: TraceFullIo;
};

/** Where TraceApp builds the trace-tree read from its ClickHouse and query-value boundaries. */
export class TraceTreeComposition {
  private constructor(private readonly options: TraceTreeCompositionOptions) {}

  static create(options: TraceTreeCompositionOptions): TraceTreeComposition {
    return new TraceTreeComposition(options);
  }

  build(): TraceService {
    const clickhouse = ResolverTraceClickHouse.create(this.options.resolveClient);
    return TraceService.create({
      repository: ClickHouseTraceSpanRepository.create(clickhouse),
      modelProviders: this.options.modelProviders,
      queryFieldValues: this.options.queryFieldValues,
      queryClassification:
        this.options.queryClassification ?? NullTraceQueryClassificationAdapter.create(),
      summaryReader: this.options.summaryReader ?? new NullTraceSummaryReader(),
      records: this.options.records ?? new NullTraceRecordRepository(),
      eventDerivation: this.options.eventDerivation ?? new NullTraceEventDerivation(),
      fullRecords: ClickHouseTraceFullRecordRepository.create(
        clickhouse,
        this.options.payloads,
        this.options.fullIo,
      ),
    });
  }
}

class ResolverTraceClickHouse extends TraceClickHouse {
  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  static create(resolveClient: TraceClickHouseResolver): ResolverTraceClickHouse {
    return new ResolverTraceClickHouse(resolveClient);
  }

  resolve(tenantId: string) {
    return this.resolveClient(tenantId);
  }
}

class NullTraceSummaryReader extends TraceSummaryReaderRepository {
  async tryGetSummary(): Promise<null> {
    return null;
  }
}

class NullTraceRecordRepository extends TraceRecordRepository {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

class NullTraceEventDerivation implements TraceEventDerivation {
  async derive(_input: TraceDerivedEventsInput): Promise<[]> {
    return [];
  }
}

class NullTraceQueryClassificationAdapter implements TraceQueryClassifier {
  private constructor() {
  }

  static create(): NullTraceQueryClassificationAdapter {
    return new NullTraceQueryClassificationAdapter();
  }

  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}

/** The trace-tree read a composition root hands around. */
export type TraceTreeService = ReturnType<TraceTreeComposition["build"]>;

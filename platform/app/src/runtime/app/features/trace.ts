import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  TraceByIdInput,
  TraceDerivedEventsInput,
  RecordSpanCommandData,
  TraceListRepository,
  TraceService,
  TraceSummaryData,
} from "@langwatch/trace-contract";
import { TraceNotFoundError, traceRecordSchema } from "@langwatch/trace-contract";
import {
  ClickHouseTraceAdapter,
  NullTraceListAdapter,
  TraceIngestionService,
  TraceIngressCommandPort,
  TraceIngressPayloadPort,
  TraceListClickHouseRepository,
  TraceQueryClassificationPort,
  TraceSpanDedupPort,
  TraceSummaryReaderPort,
  TraceEventDerivationPort,
  TraceRecordPort,
  type TraceQueryFieldValuesPort,
  type TraceClickHouseResolver,
} from "@langwatch/trace-server";
import { queryNeeds } from "~/server/app-layer/traces/filter-to-clickhouse";
import type { PrismaClient } from "~/generated/prisma/client";
import { getProtectionsForProject } from "~/server/api/utils";
import { TraceReadDerivationService } from "~/server/app-layer/traces/trace-read-derivation.service";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import type { TraceService as LegacyTraceService } from "~/server/traces/trace.service";
import type { Protections } from "~/server/traces/protections";

type AppSpanDedup = {
  tryAcquireProcessingLock(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<boolean | null>;
  tryConfirmProcessed(tenantId: string, traceId: string, spanId: string): Promise<void>;
  tryReleaseOnFailure(tenantId: string, traceId: string, spanId: string): Promise<void>;
};

class AppTraceSpanDedupAdapter extends TraceSpanDedupPort {
  private constructor(private readonly dedup: AppSpanDedup) {
    super();
  }

  static create(dedup: AppSpanDedup): AppTraceSpanDedupAdapter {
    return new AppTraceSpanDedupAdapter(dedup);
  }

  tryAcquireProcessingLock(tenantId: string, traceId: string, spanId: string) {
    return this.dedup.tryAcquireProcessingLock(tenantId, traceId, spanId);
  }

  tryConfirmProcessed(tenantId: string, traceId: string, spanId: string) {
    return this.dedup.tryConfirmProcessed(tenantId, traceId, spanId);
  }

  tryReleaseOnFailure(tenantId: string, traceId: string, spanId: string) {
    return this.dedup.tryReleaseOnFailure(tenantId, traceId, spanId);
  }
}

class AppTraceIngressCommandAdapter extends TraceIngressCommandPort {
  private constructor(private readonly dispatch: (data: RecordSpanCommandData) => Promise<void>) {
    super();
  }

  static create(
    dispatch: (data: RecordSpanCommandData) => Promise<void>,
  ): AppTraceIngressCommandAdapter {
    return new AppTraceIngressCommandAdapter(dispatch);
  }

  recordSpan(data: RecordSpanCommandData): Promise<void> {
    return this.dispatch(data);
  }
}

class AppTraceIngressPayloadAdapter extends TraceIngressPayloadPort {
  private constructor(
    private readonly prepareData: (data: RecordSpanCommandData) => Promise<RecordSpanCommandData>,
  ) {
    super();
  }

  static create(
    prepareData: (data: RecordSpanCommandData) => Promise<RecordSpanCommandData>,
  ): AppTraceIngressPayloadAdapter {
    return new AppTraceIngressPayloadAdapter(prepareData);
  }

  prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    return this.prepareData(data);
  }
}

export class AppTraceSummaryReaderAdapter extends TraceSummaryReaderPort {
  private constructor(private readonly store: FoldProjectionStore<TraceSummaryData>) {
    super();
  }

  static create(store: FoldProjectionStore<TraceSummaryData>): AppTraceSummaryReaderAdapter {
    return new AppTraceSummaryReaderAdapter(store);
  }

  tryGetSummary(input: { tenantId: string; traceId: string }): Promise<TraceSummaryData | null> {
    return this.store.get(input.traceId, {
      aggregateId: input.traceId,
      tenantId: createTenantId(input.tenantId),
    });
  }
}

export class AppTraceQueryClassificationAdapter extends TraceQueryClassificationPort {
  private constructor() {
    super();
  }

  static create(): AppTraceQueryClassificationAdapter {
    return new AppTraceQueryClassificationAdapter();
  }

  classify(query: string) {
    const needs = queryNeeds(query);
    return {
      evaluations: needs.has("evaluations"),
      events: needs.has("events"),
      spans: needs.has("spans"),
    };
  }
}

class AppTraceRecordAdapter extends TraceRecordPort {
  private readonly protectionsInFlight = new Map<string, Promise<Protections>>();

  private constructor(
    private readonly database: PrismaClient,
    private readonly traces: LegacyTraceService,
  ) {
    super();
  }

  static create(database: PrismaClient, traces: LegacyTraceService): AppTraceRecordAdapter {
    return new AppTraceRecordAdapter(database, traces);
  }

  async getById(input: TraceByIdInput) {
    const protections = await this.protections(input.projectId);
    const trace = await this.traces.getById(input.projectId, input.traceId, protections);
    if (!trace) {
      throw new TraceNotFoundError(input.traceId);
    }

    return traceRecordSchema.parse(trace);
  }

  private protections(projectId: string): Promise<Protections> {
    const inFlight = this.protectionsInFlight.get(projectId);
    if (inFlight) {
      return inFlight;
    }

    const protections = getProtectionsForProject(this.database, { projectId }).finally(() => {
      this.protectionsInFlight.delete(projectId);
    });
    this.protectionsInFlight.set(projectId, protections);

    return protections;
  }
}

class AppTraceEventDerivationAdapter extends TraceEventDerivationPort {
  private constructor(private readonly derivation: TraceReadDerivationService) {
    super();
  }

  static create(spans: SpanStorageService): AppTraceEventDerivationAdapter {
    return new AppTraceEventDerivationAdapter(new TraceReadDerivationService(spans));
  }

  derive(input: TraceDerivedEventsInput) {
    return this.derivation.deriveEvents({
      tenantId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.occurredAtMs,
      foldVersion: input.foldVersion,
    });
  }
}

export type AppTraceRuntimeOptions = {
  database: PrismaClient;
  records: LegacyTraceService;
  spans: SpanStorageService;
  resolveClient: TraceClickHouseResolver;
  modelProviders: ModelProviderService;
  queryFieldValues: TraceQueryFieldValuesPort;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
};

/** App composition for the process-owned Trace service. */
export class AppTraceRuntime {
  private constructor(private readonly options: AppTraceRuntimeOptions) {}

  static create(options: AppTraceRuntimeOptions): AppTraceRuntime {
    return new AppTraceRuntime(options);
  }

  static createNull(modelProviders: ModelProviderService): TraceService {
    return ClickHouseTraceAdapter.createNull(modelProviders);
  }

  static createListRepository(resolveClient: TraceClickHouseResolver): TraceListRepository {
    return TraceListClickHouseRepository.create(resolveClient);
  }

  static createNullListRepository(): TraceListRepository {
    return NullTraceListAdapter.create();
  }

  static createIngestion(options: {
    codingAgents: CodingAgentService;
    codingAgentSpanFilterEnabled: boolean;
    dedup: AppSpanDedup;
    recordSpan: (data: RecordSpanCommandData) => Promise<void>;
    payloads?: TraceIngressPayloadPort;
  }): TraceIngestionService {
    return TraceIngestionService.create({
      codingAgents: options.codingAgents,
      codingAgentSpanFilterEnabled: options.codingAgentSpanFilterEnabled,
      dedup: AppTraceSpanDedupAdapter.create(options.dedup),
      commands: AppTraceIngressCommandAdapter.create(options.recordSpan),
      payloads: options.payloads,
    });
  }

  static createIngressPayloadPort(
    prepare: (data: RecordSpanCommandData) => Promise<RecordSpanCommandData>,
  ): TraceIngressPayloadPort {
    return AppTraceIngressPayloadAdapter.create(prepare);
  }

  build(): TraceService {
    return ClickHouseTraceAdapter.create({
      ...this.options,
      queryClassification: AppTraceQueryClassificationAdapter.create(),
      summaryReader: AppTraceSummaryReaderAdapter.create(this.options.traceSummaryStore),
      records: AppTraceRecordAdapter.create(this.options.database, this.options.records),
      eventDerivation: AppTraceEventDerivationAdapter.create(this.options.spans),
    }).build();
  }
}

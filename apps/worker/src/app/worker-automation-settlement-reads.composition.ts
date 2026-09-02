import {
  AutomationHeartbeatPort,
  AutomationSettlementEvaluationReaderPort,
  AutomationSettlementTraceReaderPort,
  AutomationTraceRecordUnavailableError,
} from "@langwatch/automation-server";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import {
  ClickHouseEvaluationRepository,
  EvaluationRetentionFloorPort,
  type EvaluationClickHouseResolver,
} from "@langwatch/evaluation-server";
import { createTenantId, DispatchError, type FoldProjectionStore } from "@langwatch/eventing";
import type {
  DerivedTraceEvent,
  TraceQueryClassification,
  TraceRecord,
  TraceSummaryData,
} from "@langwatch/trace-contract";
import {
  ClickHouseTraceDerivationSpanReaderAdapter,
  TraceEventDerivationService,
  TraceQueryClassificationAdapter,
  type TraceClickHouseWriteResolver,
} from "@langwatch/trace-server";

/**
 * The four trace reads a settled match is confirmed and rendered from.
 *
 * Three of the four are answered from substrates this process already holds,
 * and they are the three the confirmation path actually walks: the summary is
 * the fold this process writes, the classification is a parse of the customer's
 * own query, and the events come from `stored_spans` through Trace's own
 * derivation reader with its per-fold-version memo — so a coalesced batch reads
 * a trace's events once rather than once per settled match.
 *
 * `getById` is the fourth, and it refuses. The full record is the application's
 * legacy trace read with its per-project protections resolution layered on, and
 * a background process cannot compose it. It is reached on ONE path in
 * settlement: the digest's fallback when the summary fold has not landed for a
 * trace, inside a `TraceNotFoundError` catch — so a refusal by name there costs
 * the digest one entry rather than the notification.
 */
export class WorkerAutomationSettlementTraceReader extends AutomationSettlementTraceReaderPort {
  static create(options: {
    /** The fold this process writes, read back at the same key it wrote. */
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    resolveClickHouseClient: TraceClickHouseWriteResolver;
  }): WorkerAutomationSettlementTraceReader {
    return new WorkerAutomationSettlementTraceReader(
      options.traceSummaryStore,
      TraceQueryClassificationAdapter.create(),
      TraceEventDerivationService.create({
        spans: ClickHouseTraceDerivationSpanReaderAdapter.create({
          resolveClient: options.resolveClickHouseClient,
        }),
      }),
    );
  }

  private constructor(
    private readonly summaries: FoldProjectionStore<TraceSummaryData>,
    private readonly classification: TraceQueryClassificationAdapter,
    private readonly events: TraceEventDerivationService,
  ) {
    super();
  }

  tryGetSummary(input: { projectId: string; traceId: string }): Promise<TraceSummaryData | null> {
    return this.summaries.get(input.traceId, {
      aggregateId: input.traceId,
      tenantId: createTenantId(input.projectId),
    });
  }

  getById(input: { projectId: string; traceId: string }): Promise<TraceRecord> {
    return Promise.reject(
      new AutomationTraceRecordUnavailableError(
        `This process cannot read the full record for trace ${input.traceId}: the read resolves a project's redaction protections through the application's own trace service, which is not composable here.`,
      ),
    );
  }

  classifyQuery(input: { query: string }): TraceQueryClassification {
    return this.classification.classify(input.query);
  }

  deriveEvents(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }): Promise<DerivedTraceEvent[]> {
    return this.events.derive(input);
  }
}

/**
 * The one evaluation read a settled match's filters are checked against.
 *
 * It composes Evaluation's own ClickHouse repository rather than re-issuing the
 * query: the retention floor, the dedup and the column list are that read's
 * correctness, and a second copy of them is how one process starts confirming
 * matches against runs the other has already expired. What it does NOT compose
 * is the service around it — that asks for an evaluator executor and a whole
 * workflow capability, neither of which this path reaches.
 */
export class WorkerAutomationSettlementEvaluationReader extends AutomationSettlementEvaluationReaderPort {
  static create(options: {
    resolveClickHouse: EvaluationClickHouseResolver;
    /** The event store's own retention default, so both write the same day. */
    defaultRetentionDays: number;
  }): WorkerAutomationSettlementEvaluationReader {
    return new WorkerAutomationSettlementEvaluationReader(
      ClickHouseEvaluationRepository.create({
        resolveClient: options.resolveClickHouse,
        retentionFloor: new RetentionFloorFromDefault(options.defaultRetentionDays),
      }),
    );
  }

  private constructor(
    private readonly runs: {
      findByTraceId(input: { tenantId: string; traceId: string }): Promise<EvaluationRunData[]>;
    },
  ) {
    super();
  }

  findRunsByTraceId(input: { tenantId: string; traceId: string }): Promise<EvaluationRunData[]> {
    return this.runs.findByTraceId(input);
  }
}

/**
 * The floor a read will not look below, derived from the one retention default
 * this process configures its event store with.
 *
 * A second number here would let a settled match be confirmed against runs the
 * writer had already expired, or refuse runs the writer still holds.
 */
class RetentionFloorFromDefault extends EvaluationRetentionFloorPort {
  constructor(private readonly defaultRetentionDays: number) {
    super();
  }

  async getFloorMs(): Promise<number> {
    return Date.now() - this.defaultRetentionDays * 24 * 60 * 60 * 1000;
  }
}

/**
 * The recency read the 30-second sweep decides absence from.
 *
 * The port is one method — resolve a tenant's ClickHouse client — because the
 * query it runs is the heartbeat service's own: one batched `max(OccurredAt)`
 * against the slim analytics table per project per sweep. Handing the resolver
 * rather than the query is what keeps the sweep's ONE read one read.
 */
export class WorkerAutomationHeartbeat extends AutomationHeartbeatPort {
  static create(
    resolveClient: (projectId: string) => Promise<AutomationClickHouseClient | null>,
  ): WorkerAutomationHeartbeat {
    return new WorkerAutomationHeartbeat(resolveClient);
  }

  private constructor(
    private readonly resolveClient: (
      projectId: string,
    ) => Promise<AutomationClickHouseClient | null>,
  ) {
    super();
  }

  tryResolveClickHouseClient(projectId: string): Promise<AutomationClickHouseClient | null> {
    return this.resolveClient(projectId);
  }
}

type AutomationClickHouseClient = Awaited<
  ReturnType<AutomationHeartbeatPort["tryResolveClickHouseClient"]>
>;

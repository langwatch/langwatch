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
import {
  CONTENT_CATEGORIES,
  describeAudience,
  isContentVisibleToPublic,
  type ResolvedCategory,
} from "@langwatch/data-privacy-contract";
import type { DataPrivacyResolutionService } from "@langwatch/data-privacy-server";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import { FREE_VISIBILITY_DAYS } from "@langwatch/enterprise-licensing-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import {
  TraceNotFoundError,
  traceRecordSchema,
  type DerivedTraceEvent,
  type TraceCanonicalisationService,
  type TraceQueryClassification,
  type TraceRecord,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import {
  ClickHouseTraceDerivationSpanReaderAdapter,
  ClickHouseTraceService,
  TraceEventDerivationService,
  TraceQueryClassificationAdapter,
  VisibilityWindowService,
  type Protections,
  type TraceClickHouseWriteResolver,
} from "@langwatch/trace-server";
import type { WorkerAutomationSettlementAbsenceReportPort } from "./worker-automation-settlement.composition";

/**
 * The four trace reads a settled match is confirmed and rendered from.
 *
 * Three of them are answered from substrates this process already holds, and
 * they are the three the confirmation path actually walks: the summary is the
 * fold this process writes, the classification is a parse of the customer's own
 * query, and the events come from `stored_spans` through Trace's own derivation
 * reader with its per-fold-version memo — so a coalesced batch reads a trace's
 * events once rather than once per settled match.
 *
 * `getById` is the fourth, and it is answered by {@link WorkerTraceRecordReader}
 * when this process opened a typed Prisma client — the same packaged read the
 * application performed, under the same project-scoped redactions. Without a
 * client there is nothing to compose it over, so it refuses BY NAME and the
 * absence is reported here rather than at the first degraded digest.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export class WorkerAutomationSettlementTraceReader extends AutomationSettlementTraceReaderPort {
  static create(options: {
    /** The fold this process writes, read back at the same key it wrote. */
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    resolveClickHouseClient: TraceClickHouseWriteResolver;
    /**
     * The full-record read, when this process composed one.
     *
     * Optional because it can genuinely be absent: it is built over the typed
     * Prisma client, and a graph composed without one composes no record read,
     * exactly as it composes no tenancy. `WorkerStandaloneComposition` always
     * supplies the client.
     */
    records?: WorkerTraceRecordReader | undefined;
    /** Where the missing record read is named, once, at composition. */
    absence?: Pick<WorkerAutomationSettlementAbsenceReportPort, "withoutTraceRecordRead">;
  }): WorkerAutomationSettlementTraceReader {
    if (!options.records) options.absence?.withoutTraceRecordRead();

    return new WorkerAutomationSettlementTraceReader(
      options.traceSummaryStore,
      TraceQueryClassificationAdapter.create(),
      TraceEventDerivationService.create({
        spans: ClickHouseTraceDerivationSpanReaderAdapter.create({
          resolveClient: options.resolveClickHouseClient,
        }),
      }),
      options.records,
    );
  }

  private constructor(
    private readonly summaries: FoldProjectionStore<TraceSummaryData>,
    private readonly classification: TraceQueryClassificationAdapter,
    private readonly events: TraceEventDerivationService,
    private readonly records: WorkerTraceRecordReader | undefined,
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
    const records = this.records;
    if (!records) {
      return Promise.reject(
        new AutomationTraceRecordUnavailableError(
          `This process cannot read the full record for trace ${input.traceId}: the read is composed over the typed Prisma client this graph was given, and it was given none.`,
        ),
      );
    }

    return records.getById(input);
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
 * The full trace record — spans, events and all — read the way the application
 * read it.
 *
 * ## What it is
 *
 * `ClickHouseTraceService` is Trace's own legacy read, and it is packaged: the
 * span-tree assembly, the offload preview, the annotation join and the
 * redaction pass are all inside it. The application reached the same object
 * through `TraceService.getById`, which added three things on top — git-style
 * trace-id PREFIX resolution, the coding-agent LOG JOIN and the reviewer EDIT
 * OVERLAY. None of the three belongs on this path:
 *
 *   - the prefix walk answers a human typing a truncated id into a URL; every
 *     id reaching this reader came out of a settled match's own event;
 *   - the log join needs the CANONICAL log read, which is a Log service behind
 *     a PII redaction port, and no process composes one — `apps/api` refuses it
 *     for exactly the same reason;
 *   - the edit overlay is opt-in per caller and the record read never opted in.
 *
 * ## The redactions it reads under
 *
 * The same ones the application resolved: the project's DATA-PRIVACY policy
 * taken on its PUBLIC branch (this reader is a background process, not a
 * person, so a category only a named audience may read stays hidden), every
 * `restrict` custom attribute hidden, and costs visible — which is what
 * `getProtectionsForProject` answered, and what `apps/api` still answers for a
 * project key. It fails CLOSED: an unresolvable policy hides captured content
 * and hides EVERY attribute behind a `*` pattern, because the redact helpers
 * no-op on an empty list and an outage must not be the thing that leaks.
 *
 * The plan's VISIBILITY WINDOW is filled too, from the same provider the
 * interactive process resolves it from, and it fails CLOSED the same way: a
 * project that resolves to no organization and a plan lookup that throws both
 * apply the FREE tier's window rather than answering "unbounded", because a
 * leak is irreversible and over-teasing is a refresh away. It cannot actually
 * fire on either path that reaches this reader — the digest fallback and the
 * dataset row both read a trace that has just settled a match, so the cutoff is
 * always in its past — but a field left blank because it happens to be
 * unreachable is a field that leaks the day a caller reaches it.
 */
export class WorkerTraceRecordReader {
  static create(options: {
    /**
     * The typed client the packaged read declares. It reads no row through it
     * on this path — every field of the record comes out of ClickHouse — but
     * the seam takes the generated client by type, so it is passed through
     * whole rather than cast at the boundary.
     */
    connection: PrismaConnection;
    resolveClickHouseClient: TraceClickHouseWriteResolver;
    /** The project's resolved content policy, from this process's own graph. */
    dataPrivacy: DataPrivacyResolutionService;
    /**
     * Which plan the project's organization is on, and the directory that
     * answers which organization that is.
     *
     * Not optional: both are composed over the same typed client this read is,
     * so a graph that can read a record can always answer the window — and a
     * record read that quietly skipped the window would return a free
     * organization's aged content unteased.
     */
    plans: PlanProvider;
    projects: Pick<ProjectService, "getOrganizationId">;
    /** The SAME stateless derivation the record pipeline canonicalises with. */
    traceCanonicalisation: TraceCanonicalisationService;
    logger?: Logger;
  }): WorkerTraceRecordReader {
    return new WorkerTraceRecordReader(
      ClickHouseTraceService.create({
        prisma: options.connection.client,
        // The deployment's real ClickHouse client, which this graph narrows to
        // the two methods the event store uses and the legacy read has not
        // been narrowed to. `apps/api` crosses the same seam the same way.
        resolveClickHouseClient: options.resolveClickHouseClient as never,
        traceCanonicalisation: options.traceCanonicalisation,
      }),
      options.dataPrivacy,
      new VisibilityWindowService(options.plans),
      options.projects,
      options.logger ?? createLogger("langwatch:automation:trace-record"),
    );
  }

  private constructor(
    private readonly reads: ClickHouseTraceService,
    private readonly dataPrivacy: DataPrivacyResolutionService,
    private readonly window: VisibilityWindowService,
    private readonly projects: Pick<ProjectService, "getOrganizationId">,
    private readonly logger: Logger,
  ) {}

  /**
   * The plan's cutoff for one project, failing CLOSED.
   *
   * The interactive process makes the identical decision one file away; the two
   * must agree, because a customer whose aged content is teased in the trace
   * view and copied verbatim into a dataset has not been protected at all.
   */
  private async visibilityCutoffMs(projectId: string): Promise<number | null> {
    try {
      const organizationId = await this.projects.getOrganizationId(projectId);
      return await this.window.getVisibilityCutoffMs({ organizationId });
    } catch (error) {
      this.logger.error(
        { projectId, error },
        "visibility window failing closed: plan resolution failed",
      );

      return Date.now() - FREE_VISIBILITY_DAYS * DAY_MS;
    }
  }

  async getById(input: { projectId: string; traceId: string }): Promise<TraceRecord> {
    const protections = await this.protections(input.projectId);
    const traces = await this.reads.getTracesWithSpans(
      input.projectId,
      [input.traceId],
      protections,
    );
    const trace = traces[0];
    if (!trace) {
      throw new TraceNotFoundError(input.traceId);
    }

    return traceRecordSchema.parse(trace);
  }

  /** What a background process may read of one project's captured content. */
  private async protections(projectId: string): Promise<Protections> {
    const visibleTo = "members of this project";
    const visibilityCutoffMs = await this.visibilityCutoffMs(projectId);
    try {
      const policy = await this.dataPrivacy.getResolvedForProject({ projectId });
      const restricted = policy.customAttributes.filter((rule) => rule.disposition === "restrict");
      const categories = Object.fromEntries(
        CONTENT_CATEGORIES.map((category) => {
          const resolved: ResolvedCategory = policy.categories[category];
          return [
            category,
            {
              canSee: isContentVisibleToPublic(resolved),
              restrictVisibleTo:
                resolved.disposition === "restrict"
                  ? describeAudience(resolved.audience, { groups: {} })
                  : null,
            },
          ];
        }),
      ) as Protections["contentCategories"];

      return {
        canSeeCosts: true,
        canSeeCapturedInput: categories?.input.canSee ?? false,
        canSeeCapturedOutput: categories?.output.canSee ?? false,
        capturedInputVisibleTo: categories?.input.restrictVisibleTo ?? null,
        capturedOutputVisibleTo: categories?.output.restrictVisibleTo ?? null,
        contentCategories: categories,
        hiddenAttributes: restricted.map((rule) => ({ pattern: rule.pattern, visibleTo })),
        restrictedAttributes: restricted.map((rule) => ({
          pattern: rule.pattern,
          visibleTo,
          canSee: false,
        })),
        visibilityCutoffMs,
      };
    } catch (error) {
      this.logger.error(
        { error, projectId },
        "data-privacy policy resolution failed; hiding captured content (fail-closed)",
      );

      return {
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: null,
        capturedOutputVisibleTo: null,
        hiddenAttributes: [{ pattern: "*", visibleTo }],
        visibilityCutoffMs,
      };
    }
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

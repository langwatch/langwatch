/**
 * The observability half of {@link ApiTrpcCollaborators}: the sixteen surfaces
 * a project's captured traffic is read, shared, priced and bounded through.
 *
 *   traces / tracesV2 / spans / traceEditOverlay / sharedTrace
 *   share / pinnedTrace / savedViews / topics
 *   costs / llmModelCost / modelProvider / translate
 *   httpProxy / limits / plan
 *
 * They are one composition because they are one graph, and the graph has a
 * single centre: {@link TraceApp}. Five of the sixteen ARE it; the share ledger
 * redeems an anonymous read of it, the topic tree labels its rows, the plan
 * window hides its old traces, the cost rules price its spans, and the provider
 * gateway holds the credentials the calls inside it ran on. Composing them
 * apart would mean four share services and three topic readers, and the one
 * that drifts is always the copy.
 *
 * ## This half cannot be missing
 *
 * Like the product half, and unlike analytics, identity and execution, it does
 * not fold onto a base and pass an absent one through: every one of its
 * sixteen namespaces mounts on any process that composed a database. What a
 * deployment can be missing is named INSIDE the group, capability by
 * capability, by the four ports below. A deployment then reads "this process
 * has no trace read stack" rather than discovering that a third of the product
 * is not on the wire.
 *
 * ## What is composed here, and what is still named as absent
 *
 * Composed, from this process's own connection and services:
 *
 *   - the share ledger and its redis-backed viewer cache;
 *   - the retention policy a pin is bounded by;
 *   - the topic tree and its clustering status;
 *   - the stored filter sets;
 *   - the organization's spend rollup, narrowed to the caller's own projects;
 *   - the provider gateway's application, and the two data-dependent tenant
 *     gates its writes and probes authorize through;
 *   - the tenant emitter both trace subscriptions stream off, which is the
 *     PROCESS's broadcast fabric rather than Trace's.
 *
 * Named as absent, because the implementation went with `platform/app` when the
 * monolith was deleted and no core package owns it yet:
 *
 *   - {@link ApiTraceReadStackPort} — the ClickHouse trace read stack: the ten
 *     readers `TraceApp` is built from, the caller's read-time redactions, the
 *     plan's visibility window, the span display and redaction passes, Data
 *     Privacy's content-key catalogue, the coding-agent log join, the AI
 *     composer, the reserved-metadata write and the evaluator wizard's
 *     precondition engine. Absent, every trace READ refuses by name — and both
 *     subscriptions still stream, because the emitter is this process's.
 *   - {@link ApiModelProviderHostPort} — the outbound credential probes, the
 *     Codex device flow, the cost-rule span preview and the model registry's
 *     ceilings. Absent, a probe refuses and a preview answers no matching
 *     spans, which is the safe direction: a preview that invented matches
 *     would talk somebody into a pricing rule.
 *   - {@link ApiStudioHostPort} — the studio's outbound event dispatch and the
 *     agent test's own trace write. Absent, both refuse.
 *   - {@link ApiUsageStatsPort} — the usage reading and the approaching-limit
 *     mail, over the deployment's billing store. Absent, both refuse rather
 *     than reporting zero: a usage panel showing zero of an allowance is a
 *     wrong answer, not a smaller one.
 *
 * The regex safety gate is the one capability that cannot degrade at call
 * time — the cost-rule write and preview SCHEMAS are built from it — so an
 * absent host gets a conservative gate that refuses any pattern with nested
 * unbounded quantifiers rather than a gate that says yes.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { HttpProxyTrpcPorts } from "@langwatch/agent-server";
import {
  declareAuthzMiddleware,
  type AuthzGrantsService,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import { PostgresSavedViewAdapter } from "@langwatch/dashboard-server";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import { PrismaDataRetentionAdapter } from "@langwatch/data-retention-server";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { LimitsTrpcPorts } from "@langwatch/entitlement-server";
import { HandledError } from "@langwatch/handled-error";
import {
  deriveUnmappedCostSuggestion,
  ModelProviderApp,
  type LlmModelCostTrpcPorts,
  type ModelProviderTrpcPorts,
  type TranslateTrpcPorts,
} from "@langwatch/model-provider-server";
import {
  getStaticModelCostRates,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { Cost, PrismaClient, Project } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import { PostgresShareAdapter } from "@langwatch/share-server";
import type { TopicService } from "@langwatch/topic-contract";
import { PostgresTopicAdapter, TopicClusteringSchedulePort } from "@langwatch/topic-server";
import {
  TraceApp,
  TraceEditOverlayService,
  type Protections,
  type SharedTraceTrpcPorts,
  type SpansTrpcPorts,
  type TraceAppDependencies,
  type TraceEditOverlayTrpcPorts,
  type TracesTrpcPorts,
  type TracesV2TrpcPorts,
} from "@langwatch/trace-server";
import type { TraceLegacyFilterInput, TraceLegacyListInput } from "@langwatch/trace-contract";
import type { CostTrpcPorts } from "@langwatch/entitlement-server";
import type { SavedViewTrpcPorts } from "@langwatch/dashboard-server";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../app-trpc/app-trpc.context";
import type { ModelProviderTrpcChecks } from "../features/model-provider/model-provider-trpc.mount";

// ---------------------------------------------------------------------------
// The four named absences
// ---------------------------------------------------------------------------

/**
 * The ClickHouse trace READ stack, which never left `platform/app` and went
 * with it when the monolith was deleted.
 *
 * One port rather than nine, because it is one thing: everything a captured
 * trace has to pass through between the columns it is stored in and the shape a
 * reader is allowed to see. Splitting it would suggest a deployment could hold
 * the readers without the redaction passes, and a deployment that did would
 * serve customer content to people the policy hides it from.
 *
 * `readers` is the whole of {@link TraceAppDependencies}'s trace slice: the
 * legacy read, the explorer's list, session groups, spans, summary, tree, log
 * records, canonicalisation, the reviewer-correction store and the rename
 * command. The rest are the per-request passes the two trace-view transports
 * carry.
 */
export abstract class ApiTraceReadStackPort {
  /** The ten readers `TraceApp` is composed from. */
  abstract readers(): TraceAppDependencies["traces"];
  /**
   * The caller's read-time redactions for one project: cost visibility, the
   * data-privacy policy's content categories, the restricted-attribute rules
   * and the plan's visibility cutoff.
   */
  abstract getViewerProtections(
    ctx: unknown,
    input: Readonly<{ projectId: string }>,
  ): Promise<Protections>;
  /**
   * The trace-view read ports both the explorer and the anonymous share read
   * carry: the plan window, the span display and redaction passes, Data
   * Privacy's content catalogue and the coding-agent log join.
   */
  abstract readPorts(): Pick<
    TracesV2TrpcPorts,
    "getVisibilityCutoffMs" | "mappers" | "derivedAttrPrefixes" | "codingAgentEnrichment"
  >;
  /**
   * The explorer's own: the AI composer, the reserved-metadata write and its
   * parser, the unmapped-cost suggestion, the prompt-ancestor walk and the
   * application's `trace_not_found`.
   */
  abstract explorerPorts(): Omit<
    TracesV2TrpcPorts,
    | "getViewerProtections"
    | "getVisibilityCutoffMs"
    | "mappers"
    | "derivedAttrPrefixes"
    | "codingAgentEnrichment"
    | "queryTranslation"
  >;
  /**
   * The legacy grid's two shared input schemas, the evaluator inventory's type
   * schema, the precondition rule schema and engine, and the readable digest.
   */
  abstract legacyPorts(): Omit<
    TracesTrpcPorts<TraceLegacyListInput, unknown, TraceLegacyFilterInput, unknown, unknown>,
    "getViewerProtections"
  >;
  /** The two rules a reviewer's correction is carried through. */
  abstract editOverlayRedaction(): Omit<
    TraceEditOverlayTrpcPorts<Protections>,
    "getViewerProtections"
  >;
  /**
   * The share viewer's redactions, computed for the presented session with
   * `publiclyShared` set. Null when the project is gone, which the read turns
   * into the same generic not-found a bad token gets.
   */
  abstract tryGetShareViewerProtections(input: {
    projectId: string;
    session: { user?: { id: string } } | null | undefined;
  }): Promise<Protections | null>;
  /**
   * The redactions an API KEY reads through, for the public REST doors.
   *
   * A key is not a person: the content categories resolve as they do for a
   * caller with no session, so a project that hides captured content from the
   * public hides it here too. Costs are the one difference and are always
   * visible, because every project role grants `cost:view` and a project key
   * carries full project access by design — which is exactly what
   * `getProtectionsForProject` answered.
   */
  abstract getApiKeyProtections(input: Readonly<{ projectId: string }>): Promise<Protections>;
  /** True when the read's trace no longer exists. */
  abstract isTraceNotFound(error: unknown): boolean;
}

/**
 * The model-provider capabilities that reach OUTSIDE this process: the vendor
 * credential probes, the Codex device flow, the span preview behind a cost
 * rule, the model registry's ceilings and the catastrophic-backtracking gate.
 */
export abstract class ApiModelProviderHostPort {
  abstract probes(): Pick<
    ModelProviderTrpcPorts,
    | "validateProviderApiKey"
    | "validateKeyWithCustomUrl"
    | "startCodexDeviceSignIn"
    | "pollCodexDeviceSignIn"
  >;
  abstract costRules(): LlmModelCostTrpcPorts;
  /** The provider-failure policy one translation call is wrapped in. */
  abstract translate(): TranslateTrpcPorts;
}

/** The studio's outbound event dispatch and the agent test's own trace write. */
export abstract class ApiStudioHostPort {
  abstract ports(): HttpProxyTrpcPorts;
}

/** The usage reading and the approaching-limit mail, over the billing store. */
export abstract class ApiUsageStatsPort {
  abstract ports(): LimitsTrpcPorts;
}

/** What each absence costs, written where a deployment reads its logs. */
export abstract class ApiTraceGroupAbsenceReport {
  abstract absent(
    capability: "trace-reads" | "model-provider-host" | "studio" | "usage" | "plans",
  ): void;
}

// ---------------------------------------------------------------------------
// Options and result
// ---------------------------------------------------------------------------

/** Everything the observability half is composed from. */
export type ApiTraceGroupCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The same AuthZ service the REST doors and the declared checks authorize through. */
  authz: AuthzService;
  /** Emits the authorization grants a share hands its viewer. */
  grants: AuthzGrantsService;
  /** Resolves a project's organization, team and department. */
  projects: ProjectService;
  /** Resolves a team's organization, for an organization-scoped retention rule. */
  organizations: Parameters<typeof PrismaDataRetentionAdapter.create>[0]["organizations"];
  /**
   * The process's broadcast fabric. BOTH trace subscriptions stream off the
   * tenant emitter it hands out, which is why they keep working on a process
   * that composed no trace read stack.
   */
  broadcast: PresenceEmitterPort;
  /** The retention floor a project with no policy of its own is bounded by. */
  defaultRetentionDays: number;
  /** The application's own ClickHouse, or `null` where the process composed none. */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /** The share cache and the retention meter's counters; `null` runs both uncached. */
  redis: Parameters<typeof PostgresShareAdapter.create>[0]["redis"];
  /**
   * The process's fixed-window counter, for the ONE read the open internet can
   * drive: `sharedTrace.get`, which costs five ClickHouse reads and a view
   * write per call and carries no credential at all.
   *
   * Required rather than optional, and that is the point. The per-token and
   * per-IP ceilings, the refusal and the customer copy all live in
   * `@langwatch/trace-server`; the only thing a process supplies is the
   * counter, so a process that composed this group has already decided it has
   * one. An optional leaf here would let the surface mount with a stand-in
   * that always allows, which is exactly the state this closed.
   */
  rateLimit: SharedTraceTrpcPorts["rateLimit"];
  /** The gateway this process composed, or none where it holds no cipher. */
  modelProviders: ModelProviderService | undefined;
  /** Names a refusal, so a stand-in says which process reached it. */
  processName: string;

  /** The ClickHouse trace read stack; absent refuses every trace read. */
  traceReads?: ApiTraceReadStackPort;
  /**
   * Builds the read stack over the two collaborators THIS composition owns.
   *
   * A factory rather than a finished port because the read stack needs the
   * retention cascade a span read's floor is widened to and the topic tree the
   * grid labels its rows with, and both are composed here. Handing the process
   * a second retention adapter or a second topic reader would be two answers
   * to one question, and the one that drifts is always the copy.
   *
   * `traceReads` still wins where a host supplies a finished one, which is how
   * a test names the stack it wants.
   */
  traceReadsFrom?: (
    deps: Readonly<{ dataRetention: DataRetentionService; topics: TopicService }>,
  ) => ApiTraceReadStackPort;
  /** The vendor probes and cost-rule preview; absent refuses each. */
  modelProviderHost?: ApiModelProviderHostPort;
  /** The studio dispatch and agent-test ingest; absent refuses both. */
  studio?: ApiStudioHostPort;
  /** The usage reading and its notifier; absent refuses both. */
  usage?: ApiUsageStatsPort;
  /** Which plan an organization is on; absent refuses the plan read. */
  plans?: PlanProvider;
  /** Where each absence is written down. */
  report?: ApiTraceGroupAbsenceReport;
}>;

/** The application slices and the group's ports, composed together. */
export type ApiTraceGroupCollaborators = Readonly<{
  /** For `ctx.app.traces` — the one application all five trace doors read. */
  traces: TraceApp;
  /**
   * The read stack itself, where this process composed one.
   *
   * Published alongside the application because the public REST trace doors
   * need two things `TraceApp` does not expose: the legacy read's own
   * `getAllTracesForProject` with its projection and date-axis options, and
   * the API key's read-time redactions. Both are THIS stack's, so a REST
   * caller and the browser see one trace redacted one way.
   */
  traceReads?: ApiTraceReadStackPort | undefined;
  /** For `ctx.app.share`. */
  share: ShareService;
  /** For `ctx.app.dataRetention`, which bounds a pin. */
  dataRetention: DataRetentionService;
  /** For `ctx.app.topics`. */
  topics: TopicService;
  /** For `ctx.app.modelProviders`. */
  modelProviders: ModelProviderApp;
  /** For `ctx.app.planProvider`. */
  planProvider: Pick<PlanProvider, "getActivePlan">;
  ports: ApiTraceGroupPorts;
}>;

/**
 * The thirteen tRPC ports {@link ApiTrpcCollaborators} mounts individually.
 *
 * Nested here rather than flattened onto {@link ApiTraceGroupCollaborators}
 * itself: this half also carries the `traces` APPLICATION slice under that
 * exact name, and a port and an application slice cannot share one key on one
 * object. `withApiTraceGroupCollaborators` is where the two meet — it spreads
 * these thirteen INTO the flat record, and the application slice into
 * `application` beside them.
 */
export type ApiTraceGroupPorts = Readonly<{
  traces: TracesTrpcPorts<TraceLegacyListInput, unknown, TraceLegacyFilterInput, unknown, unknown>;
  tracesV2: Omit<TracesV2TrpcPorts<unknown, unknown>, "queryTranslation">;
  spans: SpansTrpcPorts;
  traceEditOverlay: TraceEditOverlayTrpcPorts<Protections>;
  sharedTrace: SharedTraceTrpcPorts;
  savedViews: SavedViewTrpcPorts<unknown>;
  costs: CostTrpcPorts<unknown>;
  llmModelCost: LlmModelCostTrpcPorts;
  modelProvider: ModelProviderTrpcPorts<unknown, unknown>;
  modelProviderChecks: ModelProviderTrpcChecks;
  translate: TranslateTrpcPorts;
  httpProxy: HttpProxyTrpcPorts;
  limits: LimitsTrpcPorts;
}>;

/** One project's spend, as the billing screen groups it. */
export type ApiProjectSpendRollup = Readonly<{
  project: Project;
  costs: ReadonlyArray<
    Readonly<{
      projectId: string;
      costType: Cost["costType"];
      currency: string;
      referenceId?: string;
      costName?: string;
      _sum: { amount: number | null };
      _count: { id: number };
    }>
  >;
}>;

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

/**
 * Composes the observability half from this process's graph.
 *
 * Everything below is built exactly once. The share service is shared by the
 * `share.*` surface, the pin surface and the anonymous trace read's token
 * redemption; the topic reader is shared by `topics.*` and by the trace grid's
 * own topic-count labels. In both cases two of them would be two answers to one
 * question, and the one that drifts is the copy.
 */
export function composeApiTraceGroupCollaborators(
  options: ApiTraceGroupCollaboratorsOptions,
): ApiTraceGroupCollaborators {
  const refuse = refusalFactory(options.processName);

  const dataRetention = PrismaDataRetentionAdapter.create({
    database: options.prisma,
    projects: options.projects,
    organizations: options.organizations,
    defaultRetentionDays: options.defaultRetentionDays,
    redis: options.redis,
    resolveClickHouseClient: options.resolveClickHouseClient,
  });

  const share = PostgresShareAdapter.create({
    database: options.prisma,
    dataRetention,
    projects: options.projects,
    permissions: options.authz,
    grants: options.grants,
    redis: options.redis,
  });

  const topics = PostgresTopicAdapter.create({
    database: options.prisma,
    // The next clustering wake is an eventing schedule read, and this process
    // starts no scheduler. `null` is the status panel's own "not scheduled",
    // which is what a process that never schedules should say.
    schedule: new UnscheduledTopicClustering(),
  });

  const traceReads =
    options.traceReads ?? options.traceReadsFrom?.({ dataRetention, topics });
  if (!traceReads) options.report?.absent("trace-reads");

  const traces = TraceApp.create({
    traces: traceReads?.readers() ?? refuseAll<TraceAppDependencies["traces"]>(refuse, "trace read"),
    topics,
    // The PROCESS's broadcast, not Trace's: this is what makes both
    // subscriptions live on a deployment with no read stack at all.
    broadcast: options.broadcast,
    // Both are read only by the coding-agent transcript join, which this
    // process does not serve; a call refuses rather than answering an empty
    // transcript that reads as "this agent did nothing".
    //
    // What keeps that join off is the CANONICAL LOG READ the read stack
    // refuses (see `composeApiTraceReadStack`), not these two: the join's
    // first log read throws before either is reached. `codingAgents` here
    // stands in for a service this process DOES compose elsewhere (the org
    // group's), and the join needs only its pure derivation — so wiring it
    // through is a step for whoever composes the log read, and buys nothing
    // on its own.
    evaluations: refuseAll<TraceAppDependencies["evaluations"]>(refuse, "trace evaluation read"),
    codingAgents: refuseAll<TraceAppDependencies["codingAgents"]>(refuse, "coding-agent read"),
    share,
    projects: {
      tryGetById: async (projectId) => {
        const project = await options.prisma.project.findUnique({
          where: { id: projectId },
          select: { name: true, slug: true, language: true, framework: true },
        });
        return project ?? null;
      },
    },
  });

  const modelProviderHost = options.modelProviderHost;
  if (!modelProviderHost) options.report?.absent("model-provider-host");

  const modelProviders = ModelProviderApp.create({
    modelProviders:
      options.modelProviders ??
      refuseAll<ModelProviderService>(refuse, "model provider gateway"),
    // The cost-rule preview's span reader is the trace read stack's, carried
    // through the application untouched — this process only knows its concrete
    // type where it composes one.
    spans: traceReads?.readers().spans,
  });

  const studio = options.studio;
  if (!studio) options.report?.absent("studio");

  const usage = options.usage;
  if (!usage) options.report?.absent("usage");

  const planProvider = options.plans;
  if (!planProvider) options.report?.absent("plans");

  const viewerProtections = (
    ctx: unknown,
    input: Readonly<{ projectId: string }>,
  ): Promise<Protections> =>
    traceReads
      ? traceReads.getViewerProtections(ctx, input)
      : Promise.reject(refuse("the caller's read-time redactions"));

  return {
    traces,
    ...(traceReads ? { traceReads } : {}),
    share,
    dataRetention,
    topics,
    modelProviders,
    planProvider: planProvider ?? {
      getActivePlan: () => Promise.reject(refuse("the organization's active plan")),
    },
    ports: {
      traces: {
        ...(traceReads?.legacyPorts() ??
          refuseAll<Omit<TracesTrpcPorts<TraceLegacyListInput, unknown, TraceLegacyFilterInput, unknown, unknown>, "getViewerProtections">>(
            refuse,
            "the legacy trace grid",
          )),
        getViewerProtections: viewerProtections,
      },
      tracesV2: {
        ...(traceReads?.readPorts() ??
          refuseAll<ReturnType<ApiTraceReadStackPort["readPorts"]>>(refuse, "the trace read passes")),
        ...(traceReads?.explorerPorts() ??
          refuseAll<ReturnType<ApiTraceReadStackPort["explorerPorts"]>>(refuse, "the trace explorer")),
        // The unmapped-cost hint is the MODEL PROVIDER feature's reading, not
        // the trace store's: it asks whether any rule — stored or static —
        // already prices this model, and only the gateway holds the stored
        // ones. It is filled in HERE because this is the one composition that
        // holds both halves.
        deriveUnmappedCostSuggestion: (input) =>
          deriveUnmappedCostSuggestion({
            ...input,
            costs: {
              listCosts: ({ projectId }) => modelProviders.listCosts({ projectId }),
              staticCostRates: getStaticModelCostRates,
            },
          }),
        getViewerProtections: viewerProtections,
      },
      spans: { getViewerProtections: viewerProtections } satisfies SpansTrpcPorts,
      traceEditOverlay: {
        ...(traceReads?.editOverlayRedaction() ??
          refuseAll<Omit<TraceEditOverlayTrpcPorts<Protections>, "getViewerProtections">>(
            refuse,
            "the reviewer-correction redaction",
          )),
        getViewerProtections: viewerProtections,
      },
      sharedTrace: {
        mappers: (traceReads?.readPorts() ??
          refuseAll<ReturnType<ApiTraceReadStackPort["readPorts"]>>(refuse, "the trace read passes"))
          .mappers,
        tryGetShareViewerProtections: (input) =>
          traceReads
            ? traceReads.tryGetShareViewerProtections(input)
            : Promise.reject(refuse("the share viewer's redactions")),
        // The PROCESS's counter, not a second one: the 60 reads a minute per
        // share token and 120 per client address are Trace's numbers, and this
        // is only where the process says which counter they are kept in.
        rateLimit: options.rateLimit,
        getClientIp: (req) => clientIpOf(req),
        isTraceNotFound: (error) => traceReads?.isTraceNotFound(error) ?? false,
      } satisfies SharedTraceTrpcPorts,
      savedViews: {
        savedViews: PostgresSavedViewAdapter.create({ database: options.prisma }).build(),
      },
      costs: {
        readOrganizationSpend: (input) => readOrganizationSpend(options.prisma, input),
      },
      llmModelCost:
        modelProviderHost?.costRules() ?? absentCostRules(refuse),
      modelProvider: {
        ...(modelProviderHost?.probes() ??
          refuseAll<ReturnType<ApiModelProviderHostPort["probes"]>>(
            refuse,
            "the provider credential probe",
          )),
        // Fire and forget, as the router has always done: a connect is
        // recorded, but a slow audit write never holds up the sign-in response.
        recordAudit: () => undefined,
      },
      modelProviderChecks: modelProviderChecks(options.authz),
      translate:
        modelProviderHost?.translate() ?? {
          wrapAiCall: (_feature, call) => call(),
        },
      httpProxy:
        studio?.ports() ??
        refuseAll<HttpProxyTrpcPorts>(refuse, "the studio event dispatch"),
      limits: usage?.ports() ?? refuseAll<LimitsTrpcPorts>(refuse, "the usage reading"),
    },
  };
}

/**
 * Folds the observability half into a collaborator set the process assembled
 * from its other halves.
 *
 * It REFUSES rather than passing through, which is the difference between this
 * fold and the analytics, identity and execution ones. Those three can be
 * genuinely missing — a deployment with no ClickHouse composes no charted
 * reads — and the seal catches the entries they left unfilled. This half is
 * composed from the same connection the record already required, so a set
 * without it is not a smaller product, it is a set whose sixteen ports are
 * `undefined` and whose namespaces would fail while being BUILT.
 */
export function withApiTraceGroupCollaborators(
  base: AnyApiTrpcCollaborators | undefined,
  group: ApiTraceGroupCollaborators | undefined,
): AnyApiTrpcCollaborators | undefined {
  if (!base || !group) return undefined;
  return {
    ...base,
    traces: group.ports.traces,
    tracesV2: group.ports.tracesV2,
    spans: group.ports.spans,
    traceEditOverlay: group.ports.traceEditOverlay,
    sharedTrace: group.ports.sharedTrace,
    savedViews: group.ports.savedViews,
    costs: group.ports.costs,
    llmModelCost: group.ports.llmModelCost,
    modelProvider: group.ports.modelProvider,
    modelProviderChecks: group.ports.modelProviderChecks,
    translate: group.ports.translate,
    httpProxy: group.ports.httpProxy,
    limits: group.ports.limits,
    application: {
      ...base.application,
      traces: group.traces,
      share: group.share,
      dataRetention: group.dataRetention,
      topics: group.topics,
      modelProviders: group.modelProviders,
      planProvider: group.planProvider,
    } as ApiTrpcFeatureApplication,
  } as AnyApiTrpcCollaborators;
}

/** Writes each absence to the process log, with what it costs. */
export class LoggedApiTraceGroupAbsence extends ApiTraceGroupAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiTraceGroupAbsence {
    return new LoggedApiTraceGroupAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(
    capability: "trace-reads" | "model-provider-host" | "studio" | "usage" | "plans",
  ): void {
    this.logger.warn({ capability }, `${CONSEQUENCE[capability]}`);
  }
}

const CONSEQUENCE = {
  "trace-reads":
    "API process composed no trace read stack: every trace, span, correction and shared read refuses by name. The two live-update subscriptions still stream, because the emitter behind them is this process's own.",
  "model-provider-host":
    "API process composed no provider host: credential probes and the Codex device flow refuse, and a cost rule's span preview reports no matches.",
  studio:
    "API process composed no studio host: the optimization studio's outbound event and the agent test's own trace write both refuse.",
  usage:
    "API process composed no usage reader: the subscription screen's usage panel and the approaching-limit mail both refuse rather than reporting zero of an allowance.",
  plans:
    "API process composed no plan provider: `plan.getActivePlan` refuses, so no surface can resolve which plan an organization is on.",
} as const;

// ---------------------------------------------------------------------------
// The pieces this process builds for itself
// ---------------------------------------------------------------------------

/**
 * One organization's spend, rolled up per project and narrowed to the projects
 * this caller can reach.
 *
 * Two `groupBy` reads rather than one: `TRACE_CHECK` rows are grouped by the
 * evaluator they belong to as well, because the billing screen names each
 * check, and every other cost type is grouped only by type and currency.
 */
async function readOrganizationSpend(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string; startDate: number; endDate: number },
): Promise<ApiProjectSpendRollup[]> {
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        {
          team: {
            organizationId: input.organizationId,
            members: { some: { userId: input.userId } },
          },
        },
        {
          team: {
            organizationId: input.organizationId,
            organization: { members: { some: { userId: input.userId, role: "ADMIN" } } },
          },
        },
      ],
    },
  });
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const projectIds = [...projectsById.keys()];
  const createdAt = { gte: new Date(input.startDate), lte: new Date(input.endDate) };

  const [traceCheckCosts, otherCosts] = await Promise.all([
    prisma.cost.groupBy({
      by: ["projectId", "costType", "referenceId", "costName", "currency"],
      where: { projectId: { in: projectIds }, costType: "TRACE_CHECK", createdAt },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.cost.groupBy({
      by: ["projectId", "costType", "currency"],
      where: { projectId: { in: projectIds }, NOT: { costType: "TRACE_CHECK" }, createdAt },
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  const rollups = new Map<string, { project: Project; costs: unknown[] }>();
  for (const cost of [...traceCheckCosts, ...otherCosts]) {
    const project = projectsById.get(cost.projectId);
    if (!project) continue;
    const rollup = rollups.get(cost.projectId) ?? { project, costs: [] };
    rollup.costs.push(cost);
    rollups.set(cost.projectId, rollup);
  }
  return [...rollups.values()] as ApiProjectSpendRollup[];
}

/**
 * The two data-dependent gates the provider surface authorizes through.
 *
 * Both are `kind: "custom"` because neither resolves its scope id by NAME: a
 * provider belongs to an organization and reaches the scopes attached to it, so
 * a project is one valid way to name the tenant and the organization is the
 * other. What the caller may actually write is then decided per scope inside
 * the service, which is where organization scope demands `organization:manage`,
 * team demands `team:manage` and project demands `project:manage`.
 */
function modelProviderChecks(authz: AuthzService): ModelProviderTrpcChecks {
  const probe = (permission: AuthzPermission) =>
    async (params: {
      ctx: { actor(): { id: string }; permissionChecked?: boolean };
      input: { projectId?: string; organizationId?: string };
      next(): unknown;
    }) => {
      const scope = params.input.projectId
        ? { projectId: params.input.projectId }
        : { organizationId: params.input.organizationId ?? "" };
      const permitted = await authz.hasPermission({
        userId: params.ctx.actor().id,
        permission,
        ...scope,
      });
      if (!permitted) throw new ProviderTenantDeniedError(permission);
      params.ctx.permissionChecked = true;
      return params.next();
    };

  return {
    tenantWrite: (permission) =>
      declareAuthzMiddleware(
        {
          kind: "custom",
          reason:
            "the tenant anchor is data-dependent: a project when one is named, otherwise the organization the provider belongs to",
          permissions: [permission, "organization:view"],
        },
        async (params: never) => {
          const call = params as unknown as Parameters<ReturnType<typeof probe>>[0];
          return call.input.projectId
            ? probe(permission)(call)
            : probe("organization:view")(call);
        },
      ),
    credentialProbe: declareAuthzMiddleware(
      {
        kind: "custom",
        reason:
          "the credential probe goes straight out to the vendor with caller-supplied keys, so this gate IS the authorization rather than a coarse pre-filter",
        permissions: ["project:update", "organization:manage"],
      },
      async (params: never) => {
        const call = params as unknown as Parameters<ReturnType<typeof probe>>[0];
        return call.input.projectId
          ? probe("project:update")(call)
          : probe("organization:manage")(call);
      },
    ),
  };
}

/** The caller may not write providers at the tenant they named. */
class ProviderTenantDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor(permission: AuthzPermission) {
    super("permission_denied", "You do not have permission to manage model providers here", {
      httpStatus: 403,
      fault: "customer",
      meta: { permission },
    });
    this.name = "ProviderTenantDeniedError";
  }
}

/**
 * The cost-rule ports for a process with no provider host.
 *
 * `isSafeRegex` cannot refuse — the write and preview schemas are BUILT from
 * it — so it answers conservatively instead: a pattern with a quantified group
 * that is itself quantified is the catastrophic-backtracking shape, and this
 * says no to it rather than yes to everything.
 */
function absentCostRules(refuse: (capability: string) => Error): LlmModelCostTrpcPorts {
  const nestedQuantifier = /\([^)]*[+*][^)]*\)\s*[+*]/;
  return {
    isSafeRegex: (pattern) => !nestedQuantifier.test(pattern),
    getModelLimits: () => null,
    previewMatchingSpans: () => Promise.reject(refuse("the cost rule's span preview")),
  };
}

/** A process that never schedules clustering: the status panel reads "not scheduled". */
class UnscheduledTopicClustering extends TopicClusteringSchedulePort {
  tryGetNextWakeAt(): Promise<Date | null> {
    return Promise.resolve(null);
  }
}

/** The request's client IP, as far as this process resolves it. */
function clientIpOf(req: unknown): string | undefined {
  const headers = (req as { headers?: Record<string, unknown> } | undefined)?.headers;
  const forwarded = headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return typeof first === "string" ? first.split(",")[0]?.trim() : undefined;
}

/** A capability this process did not compose, refused by name at the call. */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string, capability: string) {
    super(
      "service_unavailable",
      "This part of the product is not available on this deployment",
      {
        httpStatus: 503,
        fault: "platform",
        meta: { process: processName, capability },
      },
    );
    this.name = "ApiCapabilityUnavailableError";
  }
}

function refusalFactory(processName: string) {
  return (capability: string) => new ApiCapabilityUnavailableError(processName, capability);
}

/**
 * A stand-in whose every member refuses by name.
 *
 * A proxy rather than an object literal because these are port GROUPS a
 * package declared: writing out each member would be a second declaration of
 * somebody else's interface, and the copy is what goes stale when the real one
 * grows a method. `has` answers true so a caller probing for a member finds it
 * and then learns, at the call, what is missing — rather than taking a silent
 * "not implemented" branch.
 */
function refuseAll<T>(refuse: (capability: string) => Error, capability: string): T {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw refuse(capability);
      },
      has: () => true,
    },
  ) as T;
}

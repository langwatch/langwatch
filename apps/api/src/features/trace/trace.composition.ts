import type { Protections } from "@langwatch/trace-contract";
/**
 * A project's captured traffic, composed as its own feature.
 * ADR-057 allows. Composing them apart would mean five redaction passes over
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { HandledError } from "@langwatch/handled-error";
import { type Logger } from "@langwatch/observability";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import { TraceApp, type SharedTraceTrpcPorts, type SpansTrpcPorts, type TraceAppDependencies, type TraceEditOverlayTrpcPorts, type TracesTrpcPorts, type TracesV2TrpcPorts } from "@langwatch/trace-server";
import type { TraceLegacyFilterInput, TraceLegacyListInput } from "@langwatch/trace-contract";
import type { TrpcRequestLike } from "@langwatch/api/trpc";
import { trpcClientAddress } from "../../app/api-client-address";
import type { ApiTrpcFeatureMount } from "../../api.application";
import {
  createSpansTrpcRouter,
  createTraceEditOverlayTrpcRouter,
  createTracesTrpcRouter,
} from "./trace-trpc.mount";
import { createSharedTraceTrpcRouter, createTracesV2TrpcRouter } from "./traces-v2-trpc.mount";

// ---------------------------------------------------------------------------
// The four named absences
// ---------------------------------------------------------------------------

/**
 * The ClickHouse trace READ stack, which never left `platform/app` and went with
 * it when the monolith was deleted.
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
    "tryGetVisibilityCutoffMs" | "mappers" | "derivedAttrPrefixes" | "codingAgentEnrichment"
  >;
  /**
   * The explorer's own: the AI composer, the reserved-metadata write and its
   * parser, the unmapped-cost suggestion, the prompt-ancestor walk and the
   * application's `trace_not_found`.
   */
  abstract explorerPorts(): Omit<
    TracesV2TrpcPorts,
    | "getViewerProtections"
    | "tryGetVisibilityCutoffMs"
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
   */
  abstract getApiKeyProtections(input: Readonly<{ projectId: string }>): Promise<Protections>;
  /** True when the read's trace no longer exists. */
  abstract isTraceNotFound(error: unknown): boolean;
}

/** What each absence costs, written where a deployment reads its logs. */
export abstract class ApiTraceAbsenceReport {
  abstract absent(capability: "trace-reads" | "plans"): void;
}

// ---------------------------------------------------------------------------
// Options and result
// ---------------------------------------------------------------------------

/** Everything the observability half is composed from. */
export type TraceFeatureOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The same AuthZ service the REST doors and the declared checks authorize through. */
  authz: AuthzService;
  /** Resolves a project's organization, team and department. */
  projects: ProjectService;
  /**
   * The process's broadcast fabric. BOTH trace subscriptions stream off the
   * tenant emitter it hands out, which is why they keep working on a process
   * that composed no trace read stack.
   */
  broadcast: PresenceEmitterPort;
  /** The application's own ClickHouse, or `null` where the process composed none. */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /**
   * The process's fixed-window counter, for the ONE read the open internet can
   * drive: `sharedTrace.get`, which costs five ClickHouse reads and a view write
   * per call and carries no credential at all.
   */
  rateLimit: SharedTraceTrpcPorts["rateLimit"];
  /** Names a refusal, so a stand-in says which process reached it. */
  processName: string;
  /** The other features' services the trace application is built over. */
  peers: Readonly<{
    /** The one ledger an anonymous read redeems its token against. */
    share: ShareService;
    /** The one tree the grid labels its rows from. */
    topics: TopicService;
  }>;

  /** The ClickHouse trace read stack; absent refuses every trace read. */
  traceReads?: ApiTraceReadStackPort;
  /**
   * Builds the read stack over the two collaborators THIS composition owns.
   */
  traceReadsFrom?: () => ApiTraceReadStackPort;
  /** Which plan an organization is on; absent refuses the plan read. */
  plans?: PlanProvider;
  /** Where each absence is written down. */
  report?: ApiTraceAbsenceReport;
}>;

/** The application slices and the group's ports, composed together. */
export type ComposedTraceFeature = Readonly<{
  /**
   * The five namespaces, built on the process's own root.
   */
  routers(mount: ApiTrpcFeatureMount): {
    traces: ReturnType<typeof createTracesTrpcRouter>;
    tracesV2: ReturnType<typeof createTracesV2TrpcRouter>;
    spans: ReturnType<typeof createSpansTrpcRouter>;
    traceEditOverlay: ReturnType<typeof createTraceEditOverlayTrpcRouter>;
    sharedTrace: ReturnType<typeof createSharedTraceTrpcRouter>;
  };
  /** For `ctx.app.traces` — the one application all five trace doors read. */
  traces: TraceApp;
  /**
   * The read stack itself, where this process composed one.
   */
  traceReads?: ApiTraceReadStackPort | undefined;
  /** For `ctx.app.planProvider`. */
  planProvider: Pick<PlanProvider, "getActivePlan">;
  ports: ApiTracePorts;
}>;

/**
 * The thirteen tRPC ports {@link ApiTrpcCollaborators} mounts individually.
 */
export type ApiTracePorts = Readonly<{
  traces: TracesTrpcPorts<TraceLegacyListInput, unknown, TraceLegacyFilterInput, unknown, unknown>;
  tracesV2: Omit<TracesV2TrpcPorts<unknown, unknown>, "queryTranslation">;
  spans: SpansTrpcPorts;
  traceEditOverlay: TraceEditOverlayTrpcPorts<Protections>;
  sharedTrace: SharedTraceTrpcPorts;
}>;

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

/**
 * Composes the observability half from this process's graph.
 */
export function composeTraceFeature(options: TraceFeatureOptions): ComposedTraceFeature {
  const refuse = refusalFactory(options.processName);

  const traceReads = options.traceReads ?? options.traceReadsFrom?.();
  if (!traceReads) options.report?.absent("trace-reads");

  const traces = TraceApp.create({
    traces:
      traceReads?.readers() ?? refuseAll<TraceAppDependencies["traces"]>(refuse, "trace read"),
    topics: options.peers.topics,
    // The PROCESS's broadcast, not Trace's: this is what makes both
    // subscriptions live on a deployment with no read stack at all.
    broadcast: options.broadcast,
    // Both are read only by the coding-agent transcript join, which this process does not serve; a call refuses rather than answering an empty transcript
    // that reads as "this agent did nothing". What keeps that join off is the CANONICAL LOG READ the read stack refuses (see `composeApiTraceReadStack`),
    // not these two: the join's first log read throws before either is reached. `codingAgents` here stands in for a service this process DOES compose
    // elsewhere (the org group's), and the join needs only its pure derivation — so wiring it through is a step for whoever composes the log read, and buys
    // nothing on its own.
    evaluations: refuseAll<TraceAppDependencies["evaluations"]>(refuse, "trace evaluation read"),
    codingAgents: refuseAll<TraceAppDependencies["codingAgents"]>(refuse, "coding-agent read"),
    share: options.peers.share,
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

  const planProvider = options.plans;
  if (!planProvider) options.report?.absent("plans");

  const viewerProtections = (
    ctx: unknown,
    input: Readonly<{ projectId: string }>,
  ): Promise<Protections> =>
    traceReads
      ? traceReads.getViewerProtections(ctx, input)
      : Promise.reject(refuse("the caller's read-time redactions"));

  const ports: ApiTracePorts = {
    traces: {
      ...(traceReads?.legacyPorts() ??
        refuseAll<
          Omit<
            TracesTrpcPorts<
              TraceLegacyListInput,
              unknown,
              TraceLegacyFilterInput,
              unknown,
              unknown
            >,
            "getViewerProtections"
          >
        >(refuse, "the legacy trace grid")),
      getViewerProtections: viewerProtections,
    },
    tracesV2: {
      ...(traceReads?.readPorts() ??
        refuseAll<ReturnType<ApiTraceReadStackPort["readPorts"]>>(refuse, "the trace read passes")),
      ...(traceReads?.explorerPorts() ??
        refuseAll<ReturnType<ApiTraceReadStackPort["explorerPorts"]>>(
          refuse,
          "the trace explorer",
        )),
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
      mappers: (
        traceReads?.readPorts() ??
        refuseAll<ReturnType<ApiTraceReadStackPort["readPorts"]>>(refuse, "the trace read passes")
      ).mappers,
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
  };

  return {
    routers: (mount) => mountTraceRouters(mount, ports),
    traces,
    ...(traceReads ? { traceReads } : {}),
    planProvider: planProvider ?? {
      getActivePlan: () => Promise.reject(refuse("the organization's active plan")),
    },
    ports,
  };
}

/**
 * The trace surfaces on a process that composed no database.
 */
export function refusingTraceFeature(): ComposedTraceFeature {
  const refuse = refusalFactory("langwatch-api");
  const ports = refuseAll<ApiTracePorts>(refuse, "the trace read stack");

  return {
    routers: (mount) =>
      mountTraceRouters(mount, {
        traces: refuseAll(refuse, "the legacy trace grid"),
        tracesV2: refuseAll(refuse, "the trace explorer"),
        spans: refuseAll(refuse, "the trace read passes"),
        traceEditOverlay: refuseAll(refuse, "the reviewer-correction redaction"),
        sharedTrace: refuseAll(refuse, "the anonymous trace read"),
      } as ApiTracePorts),
    traces: refuseAll<TraceApp>(refuse, "the trace application"),
    planProvider: {
      getActivePlan: () => Promise.reject(refuse("the organization's active plan")),
    },
    ports,
  };
}

/**
 * The five namespaces, on the process's own root.
 * `sharedTrace` takes the PUBLIC procedure as well: ADR-057's one anonymous
 */
function mountTraceRouters(mount: ApiTrpcFeatureMount, ports: ApiTracePorts) {
  return {
    traces: createTracesTrpcRouter({ ...mount, ports: ports.traces }),
    tracesV2: createTracesV2TrpcRouter({ ...mount, ports: ports.tracesV2 }),
    spans: createSpansTrpcRouter({ ...mount, ports: ports.spans }),
    traceEditOverlay: createTraceEditOverlayTrpcRouter({ ...mount, ports: ports.traceEditOverlay }),
    sharedTrace: createSharedTraceTrpcRouter({
      ...mount,
      publicProcedure: mount.publicProcedure,
      ports: ports.sharedTrace,
    }),
  };
}

/** Writes each absence to the process log, with what it costs. */
export class LoggedApiTraceAbsence extends ApiTraceAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiTraceAbsence {
    return new LoggedApiTraceAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "trace-reads" | "plans"): void {
    this.logger.warn({ capability }, `${CONSEQUENCE[capability]}`);
  }
}

const CONSEQUENCE = {
  "trace-reads":
    "API process composed no trace read stack: every trace, span, correction and shared read refuses by name. The two live-update subscriptions still stream, because the emitter behind them is this process's own.",
  plans:
    "API process composed no plan provider: `plan.getActivePlan` refuses, so no surface can resolve which plan an organization is on.",
} as const;

// ---------------------------------------------------------------------------
// The pieces this process builds for itself
// ---------------------------------------------------------------------------

/**
 * The request's client address, through the process's ONE resolver: the socket peer unless it is a configured trusted proxy, and then the rightmost hop that
 * proxy did not write. Taking the leftmost `x-forwarded-for` entry let a caller rotate the header, shed the per-address limit and burn a share link's view
 * cap one "new viewer" at a time.
 */
function clientIpOf(req: unknown): string | undefined {
  return trpcClientAddress(req as TrpcRequestLike | undefined);
}

/** A capability this process did not compose, refused by name at the call. */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(processName: string, capability: string) {
    super("service_unavailable", "This part of the product is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
      meta: { process: processName, capability },
    });
    this.name = "ApiCapabilityUnavailableError";
  }
}

function refusalFactory(processName: string) {
  return (capability: string) => new ApiCapabilityUnavailableError(processName, capability);
}

/**
 * A stand-in whose every member refuses by name.
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

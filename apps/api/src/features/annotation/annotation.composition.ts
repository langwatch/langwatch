/**
 * A reviewer's comments, scores and queues, composed as their own feature. `annotation.*`
 * and `annotationScore.*`, plus the `ctx.app.annotations` slice the annotation REST
 * family reads.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AnnotationApp,
  createOrUpdateQueueItems,
  PostgresAnnotationAdapter,
  PostgresAnnotationQueueAdapter,
  type AnnotationTrpcPorts,
} from "@langwatch/annotation-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { Trace } from "@langwatch/trace-contract";
import {
  ClickHouseTraceExistenceRepository,
  PrismaTraceEditOverlayRepository,
  TraceEditOverlayService,
} from "@langwatch/trace-server";
import type { UserService } from "@langwatch/user-contract";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import type { ApiTraceProducerCommands } from "../trace/trace-producer.composition";
import {
  createAnnotationScoreTrpcRouter,
  createAnnotationTrpcRouter,
} from "./annotation-trpc.mount";

/**
 * The reviewer's trace content, as the annotation queue asks for it. Declared here rather
 * than taken as a `TraceApp`, because what the queue needs is ONE read and the
 * application behind it takes twelve collaborators this process does not compose.
 */
export abstract class ApiAnnotationTraceContentPort {
  /**
   * The traces behind a set of queue items, resolved in FULL and with the caller's own
   * read-time redactions already applied.
   */
  abstract loadTraces(input: {
    userId: string;
    projectId: string;
    traceIds: readonly string[];
  }): Promise<ReadonlyArray<Trace>>;
}

/** The other features' services and directories the annotation surface reads. */
export type AnnotationPeers = Readonly<{
  /** Resolves a project's organization, team and department. */
  projects: ProjectService;
  /** Resolves a team's organization, for a queue's own scope. */
  organizations: OrganizationService;
  /** The SAME directory the browser-session boundary resolves a person through. */
  users: Pick<UserService, "getProfiles">;
  /** The trace-side senders this process registered once; see that composition. */
  traceCommands: ApiTraceProducerCommands;
}>;

/** The two namespaces and the `ctx.app.annotations` slice. */
export type ComposedAnnotationFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    annotation: ReturnType<typeof createAnnotationTrpcRouter>;
    annotationScore: ReturnType<typeof createAnnotationScoreTrpcRouter>;
  };
  /** For `ctx.app.annotations`, which the annotation REST family also reads. */
  app: AnnotationApp;
}>;

/** Composes the annotation surfaces over this process's own graph. */
export function composeAnnotationFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: AnnotationPeers;
  /**
   * The application's own ClickHouse, or `null` where the process composed
   * none. Only trace EXISTENCE is read through it here.
   */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /** The reviewer's trace content; absent refuses `annotation.getQueueItems`. */
  traceContent?: ApiAnnotationTraceContentPort;
}): ComposedAnnotationFeature {
  const { prisma, authz } = options.infrastructure;
  const { projects, organizations, users, traceCommands } = options.peers;

  const annotations = PostgresAnnotationAdapter.create({
    database: prisma,
    projects,
    organizations,
  }).build();

  const overlay = TraceEditOverlayService.create(PrismaTraceEditOverlayRepository.create(prisma));
  const traceExistence = composeTraceExistence(options.resolveClickHouseClient);
  const traceContent = options.traceContent;

  const ports: AnnotationTrpcPorts = {
    // Queue rows are Postgres, and the packaged adapter is what reads them.
    queues: () => PostgresAnnotationQueueAdapter.create({ database: prisma }).build(),

    // A suggested output rewrites the trace itself, so it is carried over only
    // for a caller who may also update annotations. The declared check on the
    // procedure covers the annotation; this covers the correction.
    probeProjectPermission: (ctx: unknown, projectId: string, permission: AuthzPermission) =>
      authz.hasPermission({ userId: actorId(ctx), permission, projectId }),

    toQueueSlug: annotationQueueSlug,

    writeTraceSuggestion: (_ctx, input) =>
      writeAnnotationSuggestionToOverlay({ overlay, ...input }),

    loadTraces: (ctx, input) =>
      traceContent
        ? traceContent.loadTraces({
            userId: actorId(ctx),
            projectId: input.projectId,
            traceIds: input.traceIds,
          })
        : Promise.reject(
            new ApiAnnotationUnavailableError(
              "trace read pipeline, so it cannot resolve the traces behind an annotation queue",
            ),
          ),

    recordAnnotationOnTrace: (_ctx, input) => traceCommands.add(input),
    removeAnnotationFromTrace: (_ctx, input) => traceCommands.remove(input),

    queueTracesForAnnotation: (_ctx, input) =>
      createOrUpdateQueueItems({
        traceIds: [...input.traceIds],
        projectId: input.projectId,
        annotators: [...input.annotators],
        userId: input.userId,
        annotations,
        // Which ids address a trace this project holds is trace storage's
        // answer, so it is resolved here rather than inside the queueing.
        findExistingTraceIds: ({ projectId, traceIds }) =>
          traceExistence.findExistingTraceIds({ projectId, traceIds }),
      }),
  };

  return {
    routers: (mount) => ({
      annotation: createAnnotationTrpcRouter({ ...mount, ports }),
      annotationScore: createAnnotationScoreTrpcRouter(mount),
    }),
    app: AnnotationApp.create({ annotations, users }),
  };
}

/**
 * The annotation surfaces on a process that composed no database or no project directory.
 */
export function refusingAnnotationFeature(): ComposedAnnotationFeature {
  const refuse = (): never => {
    throw new ApiAnnotationUnavailableError("annotation surface");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    routers: (mount) => ({
      annotation: createAnnotationTrpcRouter({
        ...mount,
        ports: refuseEvery<AnnotationTrpcPorts>(),
      }),
      annotationScore: createAnnotationScoreTrpcRouter(mount),
    }),
    app: refuseEvery<AnnotationApp>(),
  };
}

/**
 * Writes one suggestion into the trace's correction, or takes it back off when the
 * reviewer cleared the text. A suggestion rewrites the TRACE rather than the comment,
 * which is why it is an overlay write and not an annotation field.
 */
async function writeAnnotationSuggestionToOverlay(input: {
  overlay: TraceEditOverlayService;
  projectId: string;
  traceId: string;
  target: Parameters<AnnotationTrpcPorts["writeTraceSuggestion"]>[1]["target"];
  text: string;
  userId: string;
}): Promise<void> {
  const { overlay, projectId, traceId, target, text, userId } = input;
  const withdrawn = text.length === 0;
  if (target.kind === "span") {
    const span = { projectId, traceId, spanId: target.spanId, userId };
    await (withdrawn
      ? overlay.removeSpanFieldEdit({ ...span, field: target.field })
      : overlay.mergeSpanFieldEdit({ ...span, field: target.field, text }));
    return;
  }
  const trace = { projectId, traceId, field: target.field, userId };
  await (withdrawn
    ? overlay.removeTraceIOEdit(trace)
    : overlay.mergeTraceIOEdit({ ...trace, value: text }));
}

/** Which of a set of ids this project holds a trace for. */
type TraceExistence = Readonly<{
  findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]>;
}>;

/**
 * Trace existence over this process's own ClickHouse, or the empty set. The empty answer
 * is the correct one rather than a degraded one: a deployment with no trace storage holds
 * no trace to queue for review.
 */
function composeTraceExistence(
  resolve: ((tenantId: string) => Promise<ClickHouseClient>) | null,
): TraceExistence {
  if (!resolve) {
    return { findExistingTraceIds: () => Promise.resolve([]) };
  }
  return ClickHouseTraceExistenceRepository.create({ resolveClient: resolve });
}

/**
 * The slug `/annotations/<slug>` addresses, for a queue name.
 */
function annotationQueueSlug(name: string): string {
  return name
    .replace("_", "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A capability this deployment did not compose, refused by name. */
class ApiAnnotationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAnnotationUnavailableError";
  }
}

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

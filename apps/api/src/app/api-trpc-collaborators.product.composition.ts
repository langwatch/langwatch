/**
 * The product half of {@link ApiTrpcCollaborators}: the four surfaces that are
 * about a project's own CONTENT and its settings, plus the annotation slice of
 * `ctx.app`.
 *
 *   annotation.*          a reviewer's comments, scores and queues
 *   bugReports.*          the support inbox the back office reads
 *   dataPrivacy.*         the project's scoped privacy rules
 *   integrationsChecks.*  the setup checklist the onboarding screens render
 *
 * They are one composition because they are one graph in the only way that
 * matters here: every one of them is answered from this process's OWN Prisma
 * connection and its OWN AuthZ service, and three of the four reach the trace
 * pipeline for the part of their answer that is not theirs. Composing them
 * apart would mean three trace collaborators built three times, and the one
 * that drifts is always the copy.
 *
 * ## This half SEEDS the collaborator set
 *
 * The analytics, identity and execution folds all overlay onto a base and pass
 * an absent base through untouched, because each of them can genuinely be
 * missing: a deployment with no ClickHouse composes no charted reads, one with
 * no model gateway composes no execution. This half cannot be missing on a
 * process that composed a database at all — its ports are row reads with an id
 * already in hand — so it is where the set BEGINS. What refuses a half-filled
 * record is {@link sealApiTrpcCollaborators}, which names the entries a fold
 * failed to fill rather than mounting twenty-two namespaces over them.
 *
 * ## What reaches the trace pipeline, and what happens without it
 *
 * Four of the annotation ports are trace-side, and they degrade three
 * different ways because the three failures are different:
 *
 *  - the reviewer's TRACE CONTENT (`loadTraces`) refuses by name. The review
 *    page joins that content onto every queue item; answering `[]` would show
 *    a reviewer an empty queue and tell them their work was done.
 *  - the trace-side ANNOTATION MARKER (`recordAnnotationOnTrace` and its
 *    removal) rides the same `trace_processing` pipeline the worker drains,
 *    registered PRODUCER-only. With no queue it refuses rather than resolving:
 *    the port calls it best effort, and best effort is about tolerating a
 *    failure, not about hiding one.
 *  - TRACE EXISTENCE, which decides which of the ids a caller sent address a
 *    trace this project holds, answers the empty set with no ClickHouse. That
 *    is the safe direction and it is not a degradation of meaning: a
 *    deployment with no trace storage holds no trace to review, and a queue
 *    item for one would be an item the reviewer cannot read, cannot annotate
 *    and cannot get past.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AnnotationApp,
  createOrUpdateQueueItems,
  PostgresAnnotationAdapter,
  type AnnotationTrpcPorts,
} from "@langwatch/annotation-server";
import type { AuthzService } from "@langwatch/authz-contract";
import {
  DataPrivacyScopeAuthorizationService,
  DataPrivacySnapshotService,
  DataPrivacyPermissionsPort,
  PrismaDataPrivacyAdapter,
  PrismaDataPrivacyDirectoryRepository,
  type DataPrivacyTrpcPorts,
} from "@langwatch/data-privacy-server";
import type {
  DataPrivacyConfig,
  DataPrivacyPolicy,
  DataPrivacyScope,
  DataPrivacySnapshot,
} from "@langwatch/data-privacy-contract";
import type { EventSourcing } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  BugReportInboxService,
  PrismaBugReportRepository,
  type BugReportListing,
  type BugReportTrpcPorts,
} from "@langwatch/ops-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { BugReport, PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { IntegrationsChecksTrpcPorts } from "@langwatch/project-server";
import type { Trace } from "@langwatch/trace-contract";
import {
  ClickHouseTraceExistenceRepository,
  createTraceProcessingProducerPipeline,
  TraceEditOverlayService,
} from "@langwatch/trace-server";
import type { UserService } from "@langwatch/user-contract";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication, ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";

/**
 * The reviewer's trace content, as the annotation queue asks for it.
 *
 * Declared here rather than taken as a `TraceApp`, because what the queue needs
 * is ONE read and the application behind it takes twelve collaborators this
 * process does not compose. A deployment that grows a trace application
 * satisfies this with one method rather than by handing the whole thing over.
 */
export abstract class ApiAnnotationTraceContentPort {
  /**
   * The traces behind a set of queue items, resolved in FULL and with the
   * caller's own read-time redactions already applied.
   *
   * Full rather than the preview (#4991): annotators label the whole value,
   * and the review page reads each trace's metadata, timestamps and spans off
   * what this returns.
   */
  abstract loadTraces(input: {
    userId: string;
    projectId: string;
    traceIds: readonly string[];
  }): Promise<ReadonlyArray<Trace>>;
}

/**
 * Whether this project has run any simulation, for the setup checklist's own
 * step.
 *
 * The evidence is a scenario-set read in ClickHouse and the scenario vertical
 * is not composed here, so the step arrives as a port. Absent reports the step
 * as not started — which is what the application answered too whenever the
 * read failed, and the safe direction: a checklist that wrongly says "done"
 * stops somebody finishing their setup.
 */
export abstract class ApiSimulationEvidencePort {
  abstract hasAnySimulation(input: { projectId: string }): Promise<boolean>;
}

/**
 * Whether this project has a model provider attached and switched on, for the
 * setup checklist's own step.
 *
 * A port rather than a `prisma.modelProvider` read written here, and the reason
 * is the column next to the one this needs. Every credential in the deployment
 * lives on the row this question is asked of, encrypted, and
 * `specs/model-providers/encrypt-custom-keys.feature` says the only reader of
 * that table is the model-provider feature's own repository — which decrypts
 * through the deployment's cipher and hands nobody the ciphertext. The lint
 * that enforces it governs IMPORTS rather than call sites, so a composition
 * holding the client could reach the table with no such rule attached, and
 * this one did.
 *
 * `ModelProviderEvidenceService` answers it, composed from the same client and
 * the same project directory this half already holds.
 */
export abstract class ApiModelProviderEvidencePort {
  abstract hasEnabledProvider(input: { projectId: string }): Promise<boolean>;
}

/** Everything the product half is composed from. */
export type ApiProductCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The same AuthZ service the REST doors and the declared checks authorize through. */
  authz: AuthzService;
  /** Resolves a project's organization, team and department. */
  projects: ProjectService;
  /** Resolves a team's organization, for a TEAM-scoped privacy rule. */
  organizations: OrganizationService;
  /** The SAME directory the browser-session boundary resolves a person through. */
  users: Pick<UserService, "getProfiles">;
  /** Names a producer-only refusal, so a stand-in says which process reached it. */
  processName: string;
  /**
   * The application's own ClickHouse, or `null` where the process composed
   * none. Only trace EXISTENCE is read through it here.
   */
  resolveClickHouseClient: ((tenantId: string) => Promise<ClickHouseClient>) | null;
  /**
   * The producer-only eventing runtime the trace pipeline is registered on, so
   * a comment can mark the trace it was left on.
   */
  eventing: EventSourcing | undefined;
  /** The reviewer's trace content; absent refuses `annotation.getQueueItems`. */
  traceContent?: ApiAnnotationTraceContentPort;
  /** The simulations step of the setup checklist; absent reports not started. */
  simulations?: ApiSimulationEvidencePort;
  /**
   * The model-provider step of the setup checklist, read through that
   * feature's own persistence.
   *
   * Required rather than optional, unlike the simulations step beside it: this
   * one needs the guarded client and the project directory that already gate
   * this half, so there is no deployment shape in which the half composes and
   * the reader cannot be built.
   */
  modelProviders: ApiModelProviderEvidencePort;
}>;

/** The application slice and the four port groups, composed together. */
export type ApiProductCollaborators = Readonly<{
  /** For `ctx.app.annotations`. */
  annotations: AnnotationApp;
  /** The `annotation` entry of {@link ApiTrpcCollaborators}. */
  annotationPorts: ApiAnnotationPorts;
  /** The `bugReports` entry. */
  bugReportPorts: Omit<BugReportTrpcPorts<BugReportListing, BugReport>, "recordAudit">;
  /** The `dataPrivacy` entry. */
  dataPrivacyPorts: DataPrivacyTrpcPorts<DataPrivacySnapshot, DataPrivacyPolicy>;
  /** The `integrationsChecks` entry. */
  integrationsChecksPorts: IntegrationsChecksTrpcPorts<ApiOnboardingCheckStatus>;
  /**
   * The trace-side commands this process produces, published so the halves
   * composed after this one send on the SAME registration rather than making a
   * second, which the pipeline does not allow.
   */
  traceCommands: ApiTraceProducerCommands;
}>;

/** What a process can send on the `trace_processing` pipeline it produces to. */
export type ApiTraceProducerCommands = Readonly<{
  add(input: TraceAnnotationMarker): Promise<void>;
  remove(input: TraceAnnotationMarker): Promise<void>;
  /** One raw OTLP span, as the collector enqueues them. */
  recordSpan(input: unknown): Promise<void>;
}>;

/**
 * The annotation ports this half owns: everything the surface needs from the
 * TRACE side, and nothing else.
 *
 * The three left out are the process's own and are built beside the record —
 * the queue rows on the packaged Postgres adapter, the permission probe on
 * AuthZ, and the slug the annotation URLs address.
 */
export type ApiAnnotationPorts = Omit<
  AnnotationTrpcPorts,
  "queues" | "probeProjectPermission" | "toQueueSlug"
>;

/** The setup checklist, exactly as the onboarding screens read it. */
export type ApiOnboardingCheckStatus = Readonly<{
  workflows: number;
  customGraphs: number;
  datasets: number;
  onlineEvaluations: number;
  triggers: number;
  simulations: number;
  modelProviders: number;
  prompts: number;
  teamMembers: number;
  firstMessage: boolean;
  integrated: boolean;
}>;

/** Composes the product half from this process's graph. */
export function composeApiProductCollaborators(
  options: ApiProductCollaboratorsOptions,
): ApiProductCollaborators {
  const annotationService = PostgresAnnotationAdapter.create({
    database: options.prisma,
    projects: options.projects,
    organizations: options.organizations,
  }).build();

  const annotations = AnnotationApp.create({
    annotations: annotationService,
    users: options.users,
  });

  const overlay = TraceEditOverlayService.create(options.prisma);
  const traceExistence = composeTraceExistence(options);
  const traceAnnotations = composeTraceAnnotationCommands(options);

  const directory = PrismaDataPrivacyDirectoryRepository.create(options.prisma);
  const permissions = ApiDataPrivacyPermissions.create({ authz: options.authz });
  const dataPrivacy = PrismaDataPrivacyAdapter.create({
    prisma: options.prisma,
    projects: options.projects,
    organizations: options.organizations,
  });
  const snapshots = DataPrivacySnapshotService.create({
    policies: dataPrivacy,
    directory,
    permissions,
  });
  const scopeAuthorization = DataPrivacyScopeAuthorizationService.create({
    directory,
    permissions,
  });

  const bugReports = BugReportInboxService.create({
    reports: PrismaBugReportRepository.create({ prisma: options.prisma }),
  });

  const checklist = ApiOnboardingChecks.create({
    prisma: options.prisma,
    modelProviders: options.modelProviders,
    ...(options.simulations ? { simulations: options.simulations } : {}),
  });

  return {
    annotations,
    traceCommands: traceAnnotations,

    annotationPorts: {
      writeTraceSuggestion: (_ctx, input) =>
        writeAnnotationSuggestionToOverlay({ overlay, ...input }),

      loadTraces: (ctx, input) =>
        options.traceContent
          ? options.traceContent.loadTraces({
              userId: actorId(ctx),
              projectId: input.projectId,
              traceIds: input.traceIds,
            })
          : Promise.reject(
              new ApiCapabilityUnavailableError(
                "trace read pipeline, so it cannot resolve the traces behind an annotation queue",
              ),
            ),

      recordAnnotationOnTrace: (_ctx, input) => traceAnnotations.add(input),
      removeAnnotationFromTrace: (_ctx, input) => traceAnnotations.remove(input),

      queueTracesForAnnotation: (_ctx, input) =>
        createOrUpdateQueueItems({
          traceIds: [...input.traceIds],
          projectId: input.projectId,
          annotators: [...input.annotators],
          userId: input.userId,
          annotations: annotationService,
          // Which ids address a trace this project holds is trace storage's
          // answer, so it is resolved here rather than inside the queueing.
          findExistingTraceIds: ({ projectId, traceIds }) =>
            traceExistence.findExistingTraceIds({ projectId, traceIds }),
        }),
    },

    bugReportPorts: {
      getAll: (input) => bugReports.getAll(input),
      getById: (input) => bugReports.getById(input),
    },

    dataPrivacyPorts: {
      getSnapshot: (ctx, input): Promise<DataPrivacySnapshot> =>
        snapshots.getSnapshot({ userId: actorId(ctx), projectId: input.projectId }),

      setForScope: async (
        ctx,
        input: Readonly<{
          projectId: string;
          scope: DataPrivacyScope;
          personalOnly: boolean;
          config: DataPrivacyConfig;
        }>,
      ): Promise<DataPrivacyPolicy> => {
        const organizationId = await authorizeScopeWrite({
          scopeAuthorization,
          projects: options.projects,
          userId: actorId(ctx),
          projectId: input.projectId,
          scope: input.scope,
        });
        return dataPrivacy.setForScope({
          organizationId,
          scope: input.scope,
          personalOnly: input.personalOnly,
          config: input.config,
        });
      },

      removeForScope: async (
        ctx,
        input: Readonly<{
          projectId: string;
          scope: DataPrivacyScope;
          personalOnly: boolean;
        }>,
      ): Promise<void> => {
        const organizationId = await authorizeScopeWrite({
          scopeAuthorization,
          projects: options.projects,
          userId: actorId(ctx),
          projectId: input.projectId,
          scope: input.scope,
        });
        await dataPrivacy.removeForScope({
          organizationId,
          scope: input.scope,
          personalOnly: input.personalOnly,
        });
      },
    },

    integrationsChecksPorts: {
      // Annotated rather than inferred from the port: an unannotated arrow is
      // context-sensitive, so the checklist's own shape would be resolved after
      // the call's type arguments were fixed and the client would be handed
      // `{}` instead of the rollup.
      getCheckStatus: (
        _ctx: unknown,
        input: Readonly<{ projectId: string }>,
      ): Promise<ApiOnboardingCheckStatus> => checklist.getCheckStatus(input.projectId),
    },
  };
}

/**
 * Folds the product half into the collaborator set, SEEDING it when nothing
 * else has.
 *
 * The other three folds pass an absent base through untouched because each of
 * their halves can genuinely be missing. This one starts the object instead: a
 * process that composed a database can always answer these four, so there is
 * no deployment shape in which the record is missing BECAUSE of this half. A
 * host that supplied its own whole set still wins the entries it filled — the
 * spread below only replaces the four this half owns.
 */
export function withApiProductCollaborators(
  base: AnyApiTrpcCollaborators | undefined,
  product: ApiProductCollaborators | undefined,
): AnyApiTrpcCollaborators | undefined {
  if (!product) return base;
  return {
    ...(base ?? {}),
    annotation: product.annotationPorts,
    bugReports: product.bugReportPorts,
    dataPrivacy: product.dataPrivacyPorts,
    integrationsChecks: product.integrationsChecksPorts,
    application: {
      ...(base?.application ?? {}),
      annotations: product.annotations,
    },
  } as AnyApiTrpcCollaborators;
}

/** The entries a complete collaborator set carries, in the order it declares them. */
const REQUIRED_COLLABORATORS = [
  "agentGroup",
  "analytics",
  "annotation",
  "auth",
  "batchRecord",
  "bugReports",
  "dataPrivacy",
  "dataRetention",
  "dataset",
  "evaluations",
  "evaluators",
  "experiments",
  "gateway",
  "github",
  "governanceHome",
  "graphs",
  "group",
  "home",
  "identity",
  "integrationsChecks",
  "joinRequests",
  "monitors",
  "onboarding",
  "orgGroup",
  "prompts",
  "role",
  "saasBilling",
  "team",
  "user",
  "workflows",
] as const;

/** The application slices the mounted surfaces read off `ctx.app`. */
const REQUIRED_APPLICATION_SLICES: ReadonlyArray<keyof ApiTrpcFeatureApplication> = [
  "analytics",
  "annotations",
  "apiKeys",
  "authzApp",
  "automation",
  "codingAgentApp",
  "broadcast",
  "config",
  "dashboard",
  "dataset",
  "evaluations",
  "evaluatorApp",
  "experiments",
  "featureFlags",
  "gateway",
  "github",
  "governance",
  "governanceApp",
  "langy",
  "licensing",
  "monitors",
  "ops",
  "organizations",
  "permissions",
  "presence",
  "projects",
  "prompts",
  "roles",
  "scenarios",
  "storedObjectApp",
  "scimApp",
  "sessionPolicy",
  "suites",
  "usageLimits",
  "users",
  "webhooks",
  "workflows",
];

/** What a set is missing, and therefore why the record is not mountable. */
export abstract class ApiTrpcCollaboratorGapReport {
  abstract incomplete(missing: readonly string[]): void;
}

/**
 * The completeness check the folds cannot make for themselves.
 *
 * Each fold fills the entries it owns and leaves the rest alone, which is what
 * lets four of them compose in any order — and it is also what makes a
 * half-filled set indistinguishable from a full one at the call site. The
 * record is ALL OR NOTHING (see {@link ApiTrpcCollaborators}), so the set is
 * either whole here or it is `undefined` with every missing entry named. A
 * deployment then reads one line saying which capability it did not compose,
 * rather than discovering it by clicking into a namespace whose ports are not
 * there.
 */
export function sealApiTrpcCollaborators(
  candidate: AnyApiTrpcCollaborators | undefined,
  report?: ApiTrpcCollaboratorGapReport,
): AnyApiTrpcCollaborators | undefined {
  if (!candidate) return undefined;
  const held = candidate as unknown as Record<string, unknown>;
  const application = (held.application ?? {}) as Record<string, unknown>;
  const missing = [
    ...REQUIRED_COLLABORATORS.filter((entry) => held[entry] === undefined),
    ...REQUIRED_APPLICATION_SLICES.filter(
      (slice) => application[slice] === undefined,
    ).map((slice) => `application.${slice}`),
  ];
  if (missing.length === 0) return candidate;
  report?.incomplete(missing);
  return undefined;
}

/**
 * Writes one suggestion into the trace's correction, or takes it back off when
 * the reviewer cleared the text.
 *
 * A suggestion rewrites the TRACE rather than the comment, which is why it is
 * an overlay write and not an annotation field.
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
 * Trace existence over this process's own ClickHouse, or the empty set.
 *
 * The empty answer is the correct one rather than a degraded one: a deployment
 * with no trace storage holds no trace to queue for review.
 */
function composeTraceExistence(options: ApiProductCollaboratorsOptions): TraceExistence {
  const resolve = options.resolveClickHouseClient;
  if (!resolve) {
    return { findExistingTraceIds: () => Promise.resolve([]) };
  }
  return ClickHouseTraceExistenceRepository.create({ resolveClient: resolve });
}

/** The marker a comment leaves on the trace it was left on. */
type TraceAnnotationMarker = Readonly<{ tenantId: string; traceId: string; annotationId: string; occurredAt: number }>;

/**
 * The trace-side commands this process PRODUCES, sent on the SAME
 * `trace_processing` pipeline the worker drains: a reviewer's comment marker,
 * and the raw span an agent test writes.
 *
 * All three come off ONE registration because the pipeline may only be
 * registered once — a second `register` of the same definition re-declares its
 * aggregate and its event catalogue — so the process registers here, where the
 * first producer needed it, and publishes the senders the other halves need.
 *
 * Registered PRODUCER-only: this process starts no consumer loop and folds
 * nothing. Registering the packaged definition rather than a local one is what
 * keeps the routing triple every job carries identical to the one the worker
 * routes on — two descriptions of one event stream drift into jobs nothing can
 * pick up.
 */
function composeTraceAnnotationCommands(
  options: ApiProductCollaboratorsOptions,
): ApiTraceProducerCommands {
  if (!options.eventing) {
    const refuse = (): Promise<never> =>
      Promise.reject(
        new ApiCapabilityUnavailableError(
          "command queue, so it cannot record a reviewer's comment on the trace it was left on",
        ),
      );
    return { add: refuse, remove: refuse, recordSpan: refuse };
  }

  const registered = options.eventing.register(
    createTraceProcessingProducerPipeline({ processName: options.processName }),
  );
  const commands = registered.commands as Record<string, unknown>;
  const add = commands.addAnnotation;
  const remove = commands.removeAnnotation;
  const recordSpan = commands.recordSpan;
  if (!isSender(add) || !isSender(remove) || !isSender(recordSpan)) {
    throw new Error(
      'The trace_processing registration produced no "addAnnotation", "removeAnnotation" and "recordSpan" command senders; the pipeline was registered incompletely.',
    );
  }
  return {
    add: async (input) => {
      await add.send(input);
    },
    remove: async (input) => {
      await remove.send(input);
    },
    recordSpan: async (input) => {
      await recordSpan.send(input);
    },
  };
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };
const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";

/**
 * Anchors a rule write to the acting project's organization and authorizes it
 * at the TARGET scope's own tier, then answers which organization the write
 * lands in.
 *
 * The order is the one the application ran and it matters: anchoring first
 * means a request pairing a project with a scope in an unrelated tenant is
 * refused before any permission on the target is even asked about. What comes
 * back is the ACTING project's organization, which the anchor has just proven
 * equal to the scope's own.
 */
async function authorizeScopeWrite(input: {
  scopeAuthorization: DataPrivacyScopeAuthorizationService;
  projects: ProjectService;
  userId: string;
  projectId: string;
  scope: DataPrivacyScope;
}): Promise<string> {
  await input.scopeAuthorization.assertScopeBelongsToProjectOrganization({
    projectId: input.projectId,
    scope: input.scope,
  });
  await input.scopeAuthorization.assertCanWriteScope({
    userId: input.userId,
    scope: input.scope,
  });
  const project = await input.projects.getWithTeam(input.projectId);
  return project.team.organizationId;
}

/**
 * The privacy tiers' permission answers, over the SAME AuthZ service the
 * declared check on the same procedure asks.
 *
 * The two batched reads go through `canBatchByIds`, which is the one call the
 * application's own `batchScopePermissions` made: an organization's project
 * list is every project it holds, and one probe per row would be one round
 * trip per row.
 */
class ApiDataPrivacyPermissions extends DataPrivacyPermissionsPort {
  static create(dependencies: { authz: AuthzService }): ApiDataPrivacyPermissions {
    return new ApiDataPrivacyPermissions(dependencies.authz);
  }

  private constructor(private readonly authz: AuthzService) {
    super();
  }

  canManageOrganization(input: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.authz.hasPermission({
      userId: input.userId,
      permission: "organization:manage",
      organizationId: input.organizationId,
    });
  }

  async canManageTeams(input: {
    userId: string;
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.teamIds.length === 0) return new Map();
    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: "team:manage",
      organizationId: input.organizationId,
      teams: input.teamIds.map((teamId) => ({ teamId })),
      projects: [],
    });
    return decided.teams;
  }

  async canUpdateProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.projectIds.length === 0) return new Map();
    // A personal-account project has no organization, and the batched read is
    // organization-shaped. One probe per id is exact there, and the list is
    // never longer than one.
    if (!input.organizationId) {
      const decided = await Promise.all(
        input.projectIds.map(async (projectId) =>
          [
            projectId,
            await this.authz.hasPermission({
              userId: input.userId,
              permission: "project:update",
              projectId,
            }),
          ] as const,
        ),
      );
      return new Map(decided);
    }
    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: "project:update",
      organizationId: input.organizationId,
      teams: [],
      projects: input.projectIds.map((projectId) => ({ projectId })),
    });
    return decided.projects;
  }
}

/**
 * The setup checklist, fanned out over this process's own connection.
 *
 * A rollup rather than a feature service, and deliberately so: nine other
 * verticals' evidence plus the project's own two columns, and no one feature
 * package holds it — which is exactly what the port's own docblock says. Every
 * step is a `take: 1` existence probe rather than a count, because the
 * checklist only asks whether the customer has done a thing once.
 */
class ApiOnboardingChecks {
  static create(dependencies: {
    prisma: PrismaClient;
    modelProviders: ApiModelProviderEvidencePort;
    simulations?: ApiSimulationEvidencePort;
  }): ApiOnboardingChecks {
    return new ApiOnboardingChecks(
      dependencies.prisma,
      dependencies.modelProviders,
      dependencies.simulations,
    );
  }

  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:api:onboarding-checks");

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly modelProviders: ApiModelProviderEvidencePort,
    private readonly simulations: ApiSimulationEvidencePort | undefined,
  ) {}

  async getCheckStatus(projectId: string): Promise<ApiOnboardingCheckStatus> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workflows: {
          where: { archivedAt: null },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        customGraphs: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        datasets: {
          where: { archivedAt: null },
          select: { id: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        checks: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        triggers: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        team: {
          select: { organizationId: true, members: { select: { userId: true } } },
        },
      },
    });

    const [modelProviders, simulations, prompts] = await Promise.all([
      this.modelProviders.hasEnabledProvider({ projectId }),
      this.hasAnySimulation(projectId),
      this.hasVersionedPrompt(projectId),
    ]);

    const { workflows, customGraphs, datasets, checks, triggers, team } = project ?? {};

    return {
      workflows: workflows?.length ?? 0,
      customGraphs: customGraphs?.length ?? 0,
      datasets: datasets?.length ?? 0,
      onlineEvaluations: checks?.length ?? 0,
      triggers: triggers?.length ?? 0,
      simulations: simulations ? 1 : 0,
      modelProviders: modelProviders ? 1 : 0,
      prompts: prompts ? 1 : 0,
      teamMembers: team?.members?.length ?? 0,
      firstMessage: project?.firstMessage ?? false,
      integrated: project?.integrated ?? false,
    };
  }

  private async hasAnySimulation(projectId: string): Promise<boolean> {
    if (!this.simulations) return false;
    try {
      return await this.simulations.hasAnySimulation({ projectId });
    } catch (error) {
      // The step reports "not started" rather than failing the whole
      // checklist: every other step still has an answer, and the screen is a
      // prompt to finish setting up rather than a report anybody acts on.
      this.logger.warn(
        { error, projectId },
        "simulation evidence unavailable; reporting the simulations step as not started",
      );
      return false;
    }
  }

  private async hasVersionedPrompt(projectId: string): Promise<boolean> {
    const prompt = await this.prisma.llmPromptConfig.findFirst({
      where: { projectId, deletedAt: null, versions: { some: {} } },
      select: { id: true },
    });
    return prompt !== null;
  }
}

/**
 * A capability this deployment did not compose, reported to the caller.
 *
 * A handled error rather than a bare throw: the boundary serialises its code,
 * which is what a client keys its own copy off, and every one of these is a
 * DEPLOYMENT gap an operator can act on rather than a customer mistake.
 */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiCapabilityUnavailableError";
  }
}

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

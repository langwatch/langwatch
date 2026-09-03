/**
 * The PRODUCT-INFRASTRUCTURE half of {@link ApiTrpcCollaborators}: the three
 * surfaces that answer for a project's own storage, retention and monitoring
 * rather than for the product a member runs on it.
 *
 *   storedObjects  whether one externalized blob's row AND its bytes are still
 *                  there, so a renderer can tell "the file is gone" from "that
 *                  id never existed".
 *   dataRetention  how long a scope keeps what it captured, what its plan may
 *                  set that to, and how many bytes the current scope holds.
 *   monitors       the real-time evaluations running against a project's
 *                  traffic, their seven-day trend, and the copy that
 *                  replicates one — with its evaluator and that evaluator's
 *                  workflow — into another project.
 *
 * ## This half OVERLAYS, and it can genuinely be missing
 *
 * Like the analytics, execution and product-group halves, it folds onto a base
 * and passes an absent base through untouched. Two of the three surfaces stand
 * on things a deployment can legitimately not have: the object store needs a
 * ClickHouse connection AND a byte backend, and the monitor surface needs the
 * evaluator graph the execution half composed. A process holding neither has
 * no monitors to list and no bytes to probe, and mounting the namespaces over
 * that would answer a renderer "not_found" for files that exist.
 *
 * ## The named absences
 *
 * `owners` — the id-only legacy stored-object URL resolves its project by
 * scanning every ClickHouse instance the deployment operates. This process
 * composes a ROUTED connection, which resolves one tenant's client rather than
 * enumerating them, so the resolver refuses by name. Nothing on this record
 * asks it: `storedObjects.headById` carries its own `projectId`, and the
 * id-only path is the `/api/files` REST family's.
 *
 * `getMonitorPerformance` is composed now, not absent. The trend is one
 * ClickHouse read over `evaluation_runs` joined to `trace_summaries`, and
 * `@langwatch/evaluation-server` publishes it as `MonitorPerformanceAdapter` —
 * the service alone, without the evaluator executor and workflow capability
 * `EvaluationAdapter` demands and this read never touches. It runs on the SAME
 * routed connection the object probe uses.
 *
 * A deployment with NO ClickHouse still has no trend to read, and there it
 * refuses by name rather than answering `[]`: an empty trend reads as "your
 * monitors caught nothing", which is the one answer a person acts on by
 * turning a monitor off.
 *
 * ## The retention policy is composed, not re-implemented
 *
 * `@langwatch/data-retention-server` owns the rules — which permission each
 * tier demands, which values a plan may persist, the enterprise floor and the
 * paid presets. What this composition supplies is the four things those rules
 * run over and the feature may not reach: the organization directory, the
 * permission answers from the SAME AuthZ service every declared check asks,
 * the plan reading, and the platform-administrator allow-list.
 */
import { S3Client } from "@aws-sdk/client-s3";
import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import type { AuthzService } from "@langwatch/authz-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import {
  DataRetentionAdministratorPort,
  DataRetentionPermissionsPort,
  DataRetentionPlanPort,
  DataRetentionPolicyService,
  DataRetentionSnapshotService,
  PrismaDataRetentionDirectoryRepository,
  StorageMeterScopeService,
  type DataRetentionDirectoryPort,
  type DataRetentionPlan,
  type DataRetentionTrpcPolicy,
  type RetentionActor,
  type RetentionPolicySnapshot,
  type StorageScopeUsage,
} from "@langwatch/data-retention-server";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { isEnterpriseTier } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { EvaluatorReplicationApi, type EvaluatorTrpcPorts } from "@langwatch/evaluator-server";
import {
  MonitorPerformanceAdapter,
  type EvaluationClickHouseResolver,
  type MonitorPerformanceService,
} from "@langwatch/evaluation-server";
import { HandledError } from "@langwatch/handled-error";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { monitorPreconditionsSchema, type MonitorService } from "@langwatch/monitor-contract";
import { MonitorApp, type MonitorTrpcPorts } from "@langwatch/monitor-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { currentVsPreviousDates } from "@langwatch/analytics-server";
import {
  mintStoredObjectUri,
  StoredObjectOwnerResolver,
  StoredObjectService,
} from "@langwatch/stored-object-contract";
import {
  AzureBlobStoredObjectDriver,
  LocalFilesystemStoredObjectDriver,
  PrometheusStoredObjectsTelemetry,
  resolveAzureCredentials,
  S3StoredObjectDriver,
  StoredObjectApp,
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
  StoredObjectS3TargetPort,
  StoredObjectStorageRegistry,
  StoredObjectsClickHousePort,
  StoredObjectsRepository,
  StoredObjectsService,
  type StoredObjectS3Target,
  type StoredObjectsClickHouseClient,
} from "@langwatch/stored-object-server";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication, ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";
import type { ApiStoredObjectsConfigResolution } from "../platform/config/api.config";

/**
 * A capability this deployment did not compose, refused by name.
 *
 * One class for the whole half rather than one per entry: the customer-facing
 * distinction is WHICH capability is missing, and that is the `capability` the
 * message carries. A subclass per absence would be three classes for one code,
 * and the code is what the presentation registry is keyed by.
 */
class ApiProductInfraUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiProductInfraUnavailableError";
  }
}

export type ApiProductInfraCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
  /** The retention service the settings page reads and writes through. */
  dataRetention: DataRetentionService;
  /**
   * The monitor service the execution half already composed, taken rather than
   * built: an experiment upserts its own monitor through that same service, and
   * two would let the monitors list disagree with what an experiment created.
   */
  monitors: MonitorService;
  /**
   * The evaluator service the execution half composed. The monitor copy rolls
   * an evaluator back through it when the monitor insert fails.
   */
  evaluators: EvaluatorService;
  /**
   * The evaluator replication the product-group half already built over this
   * process's workflow application. Taken rather than rebuilt, because a
   * second replication would be a second answer to what copying an evaluator
   * does to the graph behind it.
   */
  evaluatorReplication: Pick<
    EvaluatorTrpcPorts,
    "replicateEvaluatorWorkflow" | "deleteReplicatedWorkflow"
  >;
  /** Which plan an organization is on, where the deployment composed a provider. */
  plans?: Pick<PlanProvider, "getActivePlan">;
  /**
   * The platform-operator allow-list, as the ops surface reads it — the SAME
   * slice `ctx.app.ops` carries, so "who may switch retention off" and "who
   * sees the operator sidebar" can never be two answers.
   */
  ops: ApiTrpcFeatureApplication["ops"];
  /**
   * The routed ClickHouse connection the object table is read through, or null
   * on a deployment that composed none.
   */
  resolveClickHouseClient: ((projectId: string) => Promise<unknown>) | null;
  /** The object storage this deployment addresses its bytes in. */
  storage: ApiStoredObjectsConfigResolution;
  /** Reports a capability this deployment did not compose. */
  report?: ApiProductInfraAbsenceReport;
}>;

/** The three application slices and the two port groups, composed together. */
export type ApiProductInfraCollaborators = Readonly<{
  /** For `ctx.app.monitors`. */
  monitorApp: MonitorApp;
  /** For `ctx.app.storedObjectApp`. */
  storedObjectApp: StoredObjectApp;
  /**
   * The CONTENT-ADDRESSED store itself, published for the one caller that
   * needs to write bytes rather than read them: the scenario-event door, whose
   * inline media the trace vertical's extractor externalises.
   *
   * The application above deliberately does not expose it — its portable half
   * refuses by name — so this is the store and not a second one. A scenario
   * recording and the same recording observed on its trace hash to the same
   * object precisely because both write through this instance.
   */
  storedObjectBytes: StoredObjectsService;
  /** The retention policy: who may write an override, and the two RBAC-filtered reads. */
  dataRetention: DataRetentionTrpcPolicy<RetentionPolicySnapshot, StorageScopeUsage>;
  /** The monitor surface's precondition parser, comparison window and evaluator replication. */
  monitors: MonitorTrpcPorts;
  /** Released with the process: the pooled outbound handlers the S3 clients share. */
  close(): Promise<void>;
}>;

/** What this half could not compose, and therefore which answer degrades. */
export abstract class ApiProductInfraAbsenceReport {
  abstract absent(capability: "clickhouse" | "plans"): void;
}

/** Composes the product-infrastructure half from this process's graph. */
export function composeApiProductInfraCollaborators(
  options: ApiProductInfraCollaboratorsOptions,
): ApiProductInfraCollaborators {
  const logger = createLogger("langwatch:api:product-infra");

  const storage = composeStoredObjects(options, logger);
  const retention = composeRetentionPolicy(options);
  const monitors = composeMonitors(options);

  return {
    monitorApp: monitors.app,
    storedObjectApp: storage.app,
    storedObjectBytes: storage.bytes,
    dataRetention: retention,
    monitors: monitors.ports,
    close: () => storage.close(),
  };
}

/**
 * Folds this half into a collaborator set the process assembled from its other
 * halves.
 *
 * A function rather than a spread at the call site, for the reason every other
 * fold gives: the record is all-or-nothing, so a set that is `undefined` stays
 * `undefined` and a half that failed to compose must not leave three
 * namespaces answering with whatever was there before.
 */
export function withApiProductInfraCollaborators(
  base: AnyApiTrpcCollaborators | undefined,
  half: ApiProductInfraCollaborators | undefined,
): AnyApiTrpcCollaborators | undefined {
  if (!base || !half) return base;
  return {
    ...base,
    dataRetention: half.dataRetention,
    monitors: half.monitors,
    application: {
      ...base.application,
      monitors: half.monitorApp,
      storedObjectApp: half.storedObjectApp,
    },
  } as AnyApiTrpcCollaborators;
}

/** Writes each absence to the process log, with what it costs. */
export class LoggedApiProductInfraAbsence extends ApiProductInfraAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiProductInfraAbsence {
    return new LoggedApiProductInfraAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "clickhouse" | "plans"): void {
    this.logger.warn({ capability }, CONSEQUENCE[capability]);
  }
}

const CONSEQUENCE = {
  clickhouse:
    "API process composed no ClickHouse connection: every stored-object probe refuses by name rather than reporting a file missing that is not, and the monitors page's seven-day trend refuses rather than reporting that no monitor caught anything.",
  plans:
    "API process composed no plan provider: every retention write refuses by name, because a plan gate that cannot read a plan must not pass.",
} as const;

// ---------------------------------------------------------------------------
// Stored objects
// ---------------------------------------------------------------------------

/**
 * The content-addressed object store, over this process's routed ClickHouse
 * connection and its own byte backend.
 *
 * The registry is built PER PROJECT because the S3 driver is: a BYOC tenant's
 * bucket lives on the tenant's own endpoint with the tenant's own credentials,
 * and one process-wide client would read another account's address space.
 */
function composeStoredObjects(
  options: ApiProductInfraCollaboratorsOptions,
  logger: Pick<Logger, "warn">,
): { app: StoredObjectApp; bytes: StoredObjectsService; close(): Promise<void> } {
  const { storage } = options;
  if (!options.resolveClickHouseClient) options.report?.absent("clickhouse");

  const aws = AwsClientProcessRuntime.create({ outboundProxy: new ApiNoOutboundProxy() });
  const targets = ApiStoredObjectS3Targets.create(options.prisma, storage);
  const destinations = StoredObjectDestinationPolicy.create({
    selection: {
      // The `azure` selection now has a driver behind it, so a write to an
      // Azure destination reaches Azure Blob rather than refusing at the byte
      // layer. It is still a SELECTION and not a fallback: a deployment that
      // named `azure` resolves to Azure, and a misconfigured Azure block
      // refuses by name rather than landing in the shared S3 bucket.
      backend: storage.backend === "azure" ? "azure" : "s3",
      ...(storage.s3.bucket ? { globalS3Bucket: storage.s3.bucket } : {}),
      localFilesystemRoot: storage.localFilesystemRoot ?? DEFAULT_LOCAL_FILESYSTEM_ROOT,
    },
    projects: ApiStoredObjectProjectBuckets.create(targets),
  });

  const service = StoredObjectsService.create({
    repository: StoredObjectsRepository.create(
      ApiStoredObjectsClickHouse.create(options.resolveClickHouseClient),
    ),
    registry: (projectId: string) =>
      new StoredObjectStorageRegistry({
        s3: S3StoredObjectDriver.create({
          projectId,
          targets,
          policy: { build: (input) => aws.build(input) },
        }),
        file: LocalFilesystemStoredObjectDriver.create(),
        // A FACTORY rather than a driver, which is the registry's own Azure
        // policy: a deployment that never reads an `azure-blob://` URI never
        // resolves credentials, so an install with no Azure block configured
        // is not made to fail at boot over a backend it does not use. The
        // resolver's `purpose: "read"` is what lets an operator who migrated
        // OFF Azure keep reading what was written before.
        "azure-blob": () =>
          AzureBlobStoredObjectDriver.create(
            resolveAzureCredentials({
              config: storage.azure,
              purpose: "read",
              identity: storage.azure.identity,
            }),
          ),
      }),
    mintStorageUri: async ({ projectId, sha256 }) =>
      mintStoredObjectUri({
        destination: await destinations.resolve(projectId),
        objectPath: `${projectId}/${sha256}`,
      }),
    telemetry: PrometheusStoredObjectsTelemetry.create(),
  });

  return {
    app: StoredObjectApp.create({
      // The byte reads are the moved service's; the PORTABLE capability — the
      // upload ceremony, the delivery capability, the metadata read — is the
      // canonical Postgres store's, which this process composes no token
      // signer or delivery policy for. It refuses by name rather than being
      // wired to the content-addressed store, because an upload confirmed
      // against one store and read back through the other is a file nobody
      // finds. Nothing on this record asks: `storedObjects.headById` is a
      // probe, and the upload doors are the `/api/files` REST family's.
      storedObjects: ApiStoredObjectPortableAbsence.create(),
      files: service,
      owners: ApiStoredObjectOwnerAbsence.create(logger),
    }),
    bytes: service,
    close: () => aws.close(),
  };
}

/** The documented single-replica fallback root, when no other is configured. */
const DEFAULT_LOCAL_FILESYSTEM_ROOT = "/var/lib/langwatch/objects";

/**
 * No outbound proxy for this process's object storage.
 *
 * Stated rather than read: the API process has no proxy configuration of its
 * own yet, and inventing one from an unrelated variable would route a tenant's
 * bytes through a host nobody chose.
 */
class ApiNoOutboundProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

/**
 * Which S3 account a project's objects belong in.
 *
 * THE PROJECT'S ORGANIZATION IS RE-READ ON EVERY RESOLUTION, deliberately.
 * Projects move between organizations, and a cached answer would keep
 * addressing the previous tenant's bucket — so the customer would see their
 * own objects disappear.
 */
class ApiStoredObjectS3Targets extends StoredObjectS3TargetPort {
  static create(
    prisma: PrismaClient,
    storage: ApiStoredObjectsConfigResolution,
  ): ApiStoredObjectS3Targets {
    return new ApiStoredObjectS3Targets(prisma, storage);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ApiStoredObjectsConfigResolution,
  ) {
    super();
  }

  /**
   * The route's values first, then the deployment's, FIELD BY FIELD — which is
   * how the platform application resolved this and why it is not a whole-object
   * fallback: a tenant may be routed to its own endpoint while still reading
   * with the deployment's credentials.
   */
  async resolve(projectId: string): Promise<StoredObjectS3Target> {
    const route = await this.tryRoute(projectId);
    const { s3 } = this.storage;

    const endpoint = route?.endpoint ?? s3.endpoint;
    const accessKeyId = route?.accessKeyId ?? s3.accessKeyId;
    const secretAccessKey = route?.secretAccessKey ?? s3.secretAccessKey;
    // Credentials only when BOTH halves of an explicit pair are present:
    // passing a partial pair short-circuits the SDK's own provider chain, which
    // is what breaks IRSA on a keyless deployment.
    const hasExplicitKeys = Boolean(accessKeyId && secretAccessKey);

    // An AWS endpoint with no explicit keys leaves the region to the SDK's own
    // chain — IRSA injects `AWS_REGION` into the pod. Anything else keeps
    // `"auto"`, which is what every non-AWS operator (R2, MinIO, a custom host)
    // has been relying on.
    const isAwsEndpoint = !endpoint || endpoint.endsWith(".amazonaws.com");
    const region = s3.region ?? (isAwsEndpoint && !hasExplicitKeys ? undefined : "auto");

    return {
      ...(endpoint ? { endpoint } : {}),
      ...(region === undefined ? {} : { region }),
      ...(hasExplicitKeys
        ? {
            credentials: {
              accessKeyId: accessKeyId!,
              secretAccessKey: secretAccessKey!,
              ...(s3.sessionToken ? { sessionToken: s3.sessionToken } : {}),
            },
          }
        : {}),
    };
  }

  /** The bucket half of the same answer, for the destination policy. */
  async tryBucket(projectId: string): Promise<string | null> {
    const route = await this.tryRoute(projectId);
    return route?.bucket ?? null;
  }

  private async tryRoute(projectId: string) {
    if (this.storage.routes.size === 0) return null;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;
    if (!organizationId) return null;
    return this.storage.routes.get(organizationId) ?? null;
  }
}

/** The bucket a BYOC project's new objects are minted against. */
class ApiStoredObjectProjectBuckets extends StoredObjectProjectS3ConfigPort {
  static create(targets: ApiStoredObjectS3Targets): ApiStoredObjectProjectBuckets {
    return new ApiStoredObjectProjectBuckets(targets);
  }

  private constructor(private readonly targets: ApiStoredObjectS3Targets) {
    super();
  }

  async tryGet(projectId: string): Promise<Readonly<{ bucket: string }> | null> {
    const bucket = await this.targets.tryBucket(projectId);
    return bucket ? { bucket } : null;
  }
}

/** This process's routed connection, as the object repository asks for it. */
class ApiStoredObjectsClickHouse extends StoredObjectsClickHousePort {
  static create(
    resolveClient: ((projectId: string) => Promise<unknown>) | null,
  ): ApiStoredObjectsClickHouse {
    return new ApiStoredObjectsClickHouse(resolveClient);
  }

  private constructor(private readonly resolve: ((projectId: string) => Promise<unknown>) | null) {
    super();
  }

  async resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient> {
    if (!this.resolve) {
      throw new ApiProductInfraUnavailableError(
        "Stored object storage, because this deployment composed no ClickHouse connection,",
      );
    }
    return (await this.resolve(projectId)) as StoredObjectsClickHouseClient;
  }
}

/**
 * The legacy id-only owner lookup, absent.
 *
 * Resolving a project from an object id alone means scanning every ClickHouse
 * instance the deployment operates. This process holds a ROUTED connection —
 * it resolves one tenant's client rather than enumerating them — so the answer
 * is refused by name. Nothing on this record asks: the tRPC probe carries its
 * own `projectId`, and the id-only URL belongs to the `/api/files` family.
 */
class ApiStoredObjectOwnerAbsence extends StoredObjectOwnerResolver {
  static create(logger: Pick<Logger, "warn">): ApiStoredObjectOwnerAbsence {
    return new ApiStoredObjectOwnerAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  async resolve(input: { id: string }): Promise<{ projectId: string } | null> {
    this.logger.warn(
      { storedObjectId: input.id },
      "API process composed no stored-object owner directory: an id-only stored-object reference cannot be resolved to a project here.",
    );
    return null;
  }
}

/**
 * The PORTABLE stored-object capability, absent.
 *
 * The upload ceremony, the delivery capability and the metadata read belong to
 * the canonical Postgres store, and this process composes neither the token
 * signer nor the delivery policy that store takes. Every one of them refuses
 * by name: substituting the content-addressed store would let an upload be
 * confirmed against one store and read back through the other, which is a file
 * the customer uploaded and nobody can find.
 */
class ApiStoredObjectPortableAbsence extends StoredObjectService {
  static create(): ApiStoredObjectPortableAbsence {
    return new ApiStoredObjectPortableAbsence();
  }

  private refuse(capability: string): never {
    throw new ApiProductInfraUnavailableError(
      `${capability}, because this deployment composed no portable stored-object store,`,
    );
  }

  storeFromBytes(): never {
    return this.refuse("Storing an object from bytes");
  }
  createUpload(): never {
    return this.refuse("Beginning a stored-object upload");
  }
  confirmUpload(): never {
    return this.refuse("Confirming a stored-object upload");
  }
  getMetadata(): never {
    return this.refuse("Reading a stored object's metadata");
  }
  getById(): never {
    return this.refuse("Reading a stored object");
  }
  resolveDelivery(): never {
    return this.refuse("Resolving a stored object's delivery capability");
  }
  streamForDelivery(): never {
    return this.refuse("Streaming a stored object for delivery");
  }
  delete(): never {
    return this.refuse("Deleting a stored object");
  }
  getStorageUsageByProject(): never {
    return this.refuse("Reading a project's stored-object usage");
  }
  deleteOwnedBy(): never {
    return this.refuse("Deleting a project's stored objects");
  }
}

// ---------------------------------------------------------------------------
// Data retention
// ---------------------------------------------------------------------------

/**
 * The retention policy this process supplies to the packaged transport.
 *
 * Each method takes the request context because the caller is resolved per
 * request; everything else is composed once. The refusals are the feature's —
 * this only translates a context into the actor the services take.
 */
function composeRetentionPolicy(
  options: ApiProductInfraCollaboratorsOptions,
): DataRetentionTrpcPolicy<RetentionPolicySnapshot, StorageScopeUsage> {
  if (!options.plans) options.report?.absent("plans");

  const directory: DataRetentionDirectoryPort = PrismaDataRetentionDirectoryRepository.create(
    options.prisma,
  );
  const permissions = ApiDataRetentionPermissions.create(options.authz);
  const policy = DataRetentionPolicyService.create({
    directory,
    permissions,
    plans: ApiDataRetentionPlans.create(options.plans),
    administrators: ApiDataRetentionAdministrators.create(options.ops),
  });
  const snapshots = DataRetentionSnapshotService.create({
    retention: options.dataRetention,
    directory,
    permissions,
    policy,
  });
  const meter = StorageMeterScopeService.create({
    retention: options.dataRetention,
    directory,
    permissions,
  });

  return {
    assertCanWriteScope: (ctx, scope) => policy.assertCanWriteScope({ actor: actorOf(ctx), scope }),
    assertWriteAllowed: (ctx, scope, retentionDays) =>
      policy.assertWriteAllowed({ actor: actorOf(ctx), scope, retentionDays }),
    assertCanDisableRetention: (ctx) => policy.assertCanDisableRetention({ actor: actorOf(ctx) }),
    assertPlanForScope: (ctx, scope) => policy.assertPlanForScope({ actor: actorOf(ctx), scope }),
    assertPlanForProject: (ctx, projectId) =>
      policy.assertPlanForProject({ actor: actorOf(ctx), projectId }),
    getPolicySnapshot: (ctx, { projectId }) =>
      snapshots.getSnapshot({ projectId, actor: actorOf(ctx) }),
    getScopeStorageUsage: (ctx, { projectId, scope }) =>
      meter.getScopeUsage({ projectId, scope, actor: actorOf(ctx) }),
  };
}

/**
 * The same request, as the EVALUATOR ports declare their context.
 *
 * The two packages narrow `ctx` to the slice each one reads — the monitor
 * surface names `app.monitors`, the evaluator replication names
 * `app.evaluatorApp` — and this process's real context carries both. Named at
 * the one seam that hands a request from one feature's port signature to
 * another's, so the crossing is written down rather than repeated inline.
 */
function evaluatorContext(
  ctx: unknown,
): Parameters<EvaluatorTrpcPorts["replicateEvaluatorWorkflow"]>[0] {
  return ctx as Parameters<EvaluatorTrpcPorts["replicateEvaluatorWorkflow"]>[0];
}

/** The signed-in caller, as the retention services name them. */
function actorOf(ctx: unknown): RetentionActor {
  const session = (ctx as ApiTrpcPortsContext).session;
  return {
    userId: session?.user?.id ?? null,
    email: session?.user?.email ?? null,
  };
}

/**
 * The retention tiers' permission answers, over the SAME AuthZ service the
 * declared check on the same procedure asks.
 *
 * The batched reads go through `canBatchByIds`, which is the one call the
 * application's own `batchScopePermissions` made: an organization's project
 * list is every project it holds, and one probe per row would be one round
 * trip per row.
 */
class ApiDataRetentionPermissions extends DataRetentionPermissionsPort {
  static create(authz: AuthzService): ApiDataRetentionPermissions {
    return new ApiDataRetentionPermissions(authz);
  }

  private constructor(private readonly authz: AuthzService) {
    super();
  }

  canManageOrganization(input: { userId: string; organizationId: string }): Promise<boolean> {
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

  canUpdateProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return this.decideProjects({ ...input, permission: "project:update" });
  }

  canViewTraces(input: {
    userId: string;
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>> {
    return this.decideProjects({ ...input, permission: "traces:view" });
  }

  private async decideProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
    permission: "project:update" | "traces:view";
  }): Promise<ReadonlyMap<string, boolean>> {
    if (input.projectIds.length === 0) return new Map();
    // A personal-account project has no organization, and the batched read is
    // organization-shaped. One probe per id is exact there, and the list is
    // never longer than one.
    if (!input.organizationId) {
      const decided = await Promise.all(
        input.projectIds.map(
          async (projectId) =>
            [
              projectId,
              await this.authz.hasPermission({
                userId: input.userId,
                permission: input.permission,
                projectId,
              }),
            ] as const,
        ),
      );
      return new Map(decided);
    }
    const decided = await this.authz.canBatchByIds({
      principal: { type: "user", id: input.userId },
      permission: input.permission,
      organizationId: input.organizationId,
      teams: [],
      projects: input.projectIds.map((projectId) => ({ projectId })),
    });
    return decided.projects;
  }
}

/**
 * The plan behind a retention gate, reduced to the two facts retention tiers
 * on.
 *
 * `uncapped` is where this deployment's billing and licensing plumbing stops:
 * an enterprise tier, or a self-hosted install, may take any whole-week value
 * above the feature's own floor. Everything else — which values that means —
 * is the retention feature's and stays there. An unrecognised tier resolves to
 * `false`, which fails CLOSED to the restrictive menu.
 */
class ApiDataRetentionPlans extends DataRetentionPlanPort {
  static create(plans: Pick<PlanProvider, "getActivePlan"> | undefined): ApiDataRetentionPlans {
    return new ApiDataRetentionPlans(plans);
  }

  private constructor(private readonly plans: Pick<PlanProvider, "getActivePlan"> | undefined) {
    super();
  }

  async getPlan(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<DataRetentionPlan> {
    if (!this.plans) {
      throw new ApiProductInfraUnavailableError(
        "The organization's active plan, which every retention gate is decided against,",
      );
    }
    const plan: PlanInfo = await this.plans.getActivePlan({
      organizationId: input.organizationId,
      ...(input.userId ? { user: { id: input.userId } } : {}),
    } as never);
    return { free: plan.free, uncapped: isEnterpriseTier(plan.type) };
  }
}

/** The platform-operator allow-list, as the ops surface reads it. */
class ApiDataRetentionAdministrators extends DataRetentionAdministratorPort {
  static create(ops: ApiTrpcFeatureApplication["ops"]): ApiDataRetentionAdministrators {
    return new ApiDataRetentionAdministrators(ops);
  }

  private constructor(private readonly ops: ApiTrpcFeatureApplication["ops"]) {
    super();
  }

  isPlatformAdministrator(input: { userId: string | null; email: string | null }): boolean {
    // The slice declares its identity structurally, because the surfaces that
    // read it name different halves of a person. The one field this answer
    // turns on is the address the allow-list is written in.
    return this.ops.isAdmin({ email: input.email ?? undefined } as never);
  }
}

// ---------------------------------------------------------------------------
// Monitors
// ---------------------------------------------------------------------------

/**
 * The seven-day trend, over the SAME routed ClickHouse the object probe reads.
 *
 * The trend alone: `MonitorPerformanceAdapter` composes the read and the fold
 * that turns its buckets into a guardrail's pass rate or an evaluator's mean
 * score, and nothing else. `EvaluationAdapter` would compose the same read
 * behind an evaluator executor and a workflow capability this process never
 * asks the trend for.
 *
 * With no connection there is nothing to read, and the answer is a refusal by
 * name rather than an empty trend, which a person would read as "no monitor
 * caught anything" and act on by switching a monitor off.
 */
function composeMonitorPerformance(
  options: ApiProductInfraCollaboratorsOptions,
): Pick<MonitorPerformanceService, "getMonitorPerformance"> {
  const resolve = options.resolveClickHouseClient;
  if (!resolve) {
    return {
      getMonitorPerformance: () =>
        Promise.reject(
          new ApiProductInfraUnavailableError(
            "The monitor performance trend, because this deployment composed no ClickHouse connection,",
          ),
        ),
    };
  }
  // The one cast this seam takes, and the same one the stored-object port
  // takes above: the routed connection is typed `unknown` here so this module
  // does not have to name a ClickHouse client, and each reader states the
  // shape its own package declares.
  return MonitorPerformanceAdapter.create({
    resolveClickHouse: resolve as EvaluationClickHouseResolver,
  });
}

function composeMonitors(options: ApiProductInfraCollaboratorsOptions): {
  app: MonitorApp;
  ports: MonitorTrpcPorts;
} {
  const app = MonitorApp.create({
    monitors: options.monitors,
    evaluations: composeMonitorPerformance(options),
    evaluators: options.evaluators,
  });

  return {
    app,
    ports: {
      /**
       * The precondition SHAPE, not its vocabulary.
       *
       * Which rules a given field may carry is the trace-filter registry's
       * answer, and that registry now lives in a browser package no server
       * module may value-import. So this parses what the wire has always
       * required and no more: the cross-check between a precondition's field
       * and its rule returns with the registry.
       */
      preconditionsSchema: monitorPreconditionsSchema,
      // The previous window comes from the same helper the analytics page
      // uses, so the trend comparison covers the exact same runs a person sees
      // when they open analytics for this evaluation.
      resolvePreviousPeriodStartMs: ({ startMs, endMs }) =>
        currentVsPreviousDates({
          startDate: startMs,
          endDate: endMs,
        }).previousPeriodStartDate.getTime(),
      copyEvaluatorToProject: (ctx, input) =>
        EvaluatorReplicationApi.create({
          replicateEvaluatorWorkflow: (replication) =>
            options.evaluatorReplication.replicateEvaluatorWorkflow(
              evaluatorContext(ctx),
              replication,
            ),
          deleteReplicatedWorkflow: (replication) =>
            options.evaluatorReplication.deleteReplicatedWorkflow(
              evaluatorContext(ctx),
              replication,
            ),
        }).copyToProject({
          evaluators: options.evaluators,
          ...input,
        }),
      deleteReplicatedWorkflow: (ctx, input) =>
        options.evaluatorReplication.deleteReplicatedWorkflow(evaluatorContext(ctx), input),
    },
  };
}

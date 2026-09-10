/**
 * A project's own object store, installed over this process's own graph.
 * `storedObjects.*` answers whether an externalized blob's ROW and its BYTES
 * are both still there, so a renderer tells "gone" from "never existed".
 */
import { S3Client } from "@aws-sdk/client-s3";
import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp } from "@langwatch/runtime-composition";
import {
  mintStoredObjectUri,
  StoredObjectOwnerResolver,
  type StoredObjectDeliveryCapability,
  type StoredObjectUploadTokenClaims,
} from "@langwatch/stored-object-contract";
import {
  AbsentPayloadStagingAdapter,
  AzureBlobCredentialsAdapter,
  AzureBlobStoredObjectDriverAdapter,
  StoredObjectBlobFilesystemRepository,
  PayloadStagingPort,
  PayloadStagingS3TargetPort,
  PrometheusStoredObjectsTelemetryAdapter,
  S3PayloadStagingAdapter,
  StoredObjectBlobS3Repository,
  StoredObjectDeliveryPort,
  StoredObjectDestinationPolicyAdapter,
  StoredObjectOwnerInstanceDirectoryPort,
  StoredObjectOwnerLookupRuntimeAdapter,
  StoredObjectOwnerLookupTelemetryPort,
  StoredObjectProjectS3ConfigPort,
  StoredObjectS3TargetPort,
  StoredObjectStoragePortAdapter,
  StoredObjectStorageRegistryAdapter,
  StoredObjectStorageRuntimeAdapter,
  StoredObjectUploadTokenPort,
  StoredObjectsClickHousePort,
  StoredObjectsService,
  deriveStoredObjectId,
  storedObjectServer,
  type PayloadStagingS3Target,
  type StoredObjectOwnerClickHouseClient,
  type StoredObjectOwnerClickHouseInstance,
  type StoredObjectS3Target,
  type StoredObjectStorageDriver,
  type StoredObjectsClickHouseClient,
} from "@langwatch/stored-object-server";
import { ClickHouseStoredObjectsRepository } from "@langwatch/stored-object-server/composition/stored-objects";

import type { ApiStoredObjectsConfigResolution } from "../../platform/config/api.config.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createStoredObjectTrpcRouter } from "./stored-object-trpc.mount.ts";
import type { ComposedStoredObjectFeature } from "./stored-object.composition.types.ts";

/** Reports the one capability this feature can be installed without. */
export abstract class ApiStoredObjectAbsenceReport {
  abstract absent(capability: "clickhouse"): void;
}

/** Writes the absence to the process log, once, at composition time. */
export class LoggedApiStoredObjectAbsence extends ApiStoredObjectAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiStoredObjectAbsence {
    return new LoggedApiStoredObjectAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "clickhouse"): void {
    this.logger.warn(
      { capability },
      "API process composed no ClickHouse connection: every stored-object probe refuses by name rather than reporting a file missing that is not.",
    );
  }
}

/** Everything the object store is installed from. */
export type StoredObjectFeatureCollaborators = Readonly<{
  prisma: ApiTrpcInfrastructure["prisma"];
  /**
   * The routed ClickHouse connection the object table is read through, or null
   * on a deployment that composed none.
   */
  resolveClickHouseClient: ((projectId: string) => Promise<unknown>) | null;
  /**
   * Every ClickHouse endpoint this process is configured for. The legacy id-only
   * delivery URL carries no project, so resolving its owner is the one read that
   * genuinely spans them; absent, those URLs resolve to nothing.
   */
  clickHouseInstances?: (() => readonly ApiStoredObjectOwnerInstance[]) | null | undefined;
  /** The object storage this deployment addresses its bytes in. */
  storage: ApiStoredObjectsConfigResolution;
  report?: ApiStoredObjectAbsenceReport;
}>;

/**
 * The byte ceiling and upload window the lifecycle service is built with.
 * Stated rather than configured: this deployment composes no direct-upload
 * target, so the ceremony they bound is unreachable.
 */
const MAXIMUM_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_EXPIRY_MS = 300_000;

/** The documented single-replica fallback root, when no other is configured. */
const DEFAULT_LOCAL_FILESYSTEM_ROOT = "/var/lib/langwatch/objects";

/** Installs the object store over this process's own graph. */
export async function installApiStoredObject(
  options: StoredObjectFeatureCollaborators,
): Promise<ComposedStoredObjectFeature> {
  const logger = createLogger("langwatch:api:stored-object");
  const { storage } = options;
  if (!options.resolveClickHouseClient) options.report?.absent("clickhouse");

  const aws = AwsClientProcessRuntime.create({ outboundProxy: new ApiNoOutboundProxy() });
  const targets = ApiStoredObjectS3Targets.create(options.prisma, storage);
  const destinations = StoredObjectDestinationPolicyAdapter.create({
    selection: {
      // The `azure` selection has a driver behind it, so a write to an Azure
      // destination reaches Azure Blob rather than refusing at the byte layer.
      // It is still a SELECTION and not a fallback: a deployment that named
      // `azure` resolves to Azure, and a misconfigured Azure block refuses by
      // name rather than landing in the shared S3 bucket.
      backend: storage.backend === "azure" ? "azure" : "s3",
      ...(storage.s3.bucket ? { globalS3Bucket: storage.s3.bucket } : {}),
      localFilesystemRoot: storage.localFilesystemRoot ?? DEFAULT_LOCAL_FILESYSTEM_ROOT,
    },
    projects: ApiStoredObjectProjectBuckets.create(targets),
  });

  // ONE set of driver factories, read by both the indexed object store below
  // and the project-keyed runtime published beside it, so a consumer that
  // writes bytes without a row lands in the same place a stored object does.
  const s3ForProject = (projectId: string, awsRuntime: AwsClientProcessRuntime) =>
    StoredObjectBlobS3Repository.create({
      projectId,
      targets,
      policy: { build: (input) => awsRuntime.build(input) },
    });
  const fileForProject = () => StoredObjectBlobFilesystemRepository.create();
  // A FACTORY rather than a driver, which is the registry's own Azure policy: a
  // deployment that never reads an `azure-blob://` URI never resolves credentials,
  // so an install with no Azure block configured is not made to fail at boot over a
  // backend it does not use. The resolver's `purpose: "read"` is what lets an
  // operator who migrated OFF Azure keep reading what was written before.
  const azureForProject = (): StoredObjectStorageDriver =>
    AzureBlobStoredObjectDriverAdapter.create(
      AzureBlobCredentialsAdapter.resolveAzureCredentials({
        config: storage.azure,
        purpose: "read",
        identity: storage.azure.identity,
      }),
    );

  const storageRuntime = StoredObjectStorageRuntimeAdapter.create({
    destination: destinations,
    s3ForProject,
    fileForProject,
    azureForProject,
  });

  const bytes = StoredObjectsService.create({
    repository: ClickHouseStoredObjectsRepository.create(
      ApiStoredObjectsClickHouse.create(options.resolveClickHouseClient),
    ),
    registry: (projectId: string) =>
      StoredObjectStorageRegistryAdapter.create({
        s3: s3ForProject(projectId, aws),
        file: fileForProject(),
        "azure-blob": azureForProject,
      }),
    mintStorageUri: async ({ projectId, sha256 }) =>
      mintStoredObjectUri({
        destination: await destinations.resolve(projectId),
        objectPath: `${projectId}/${sha256}`,
      }),
    telemetry: PrometheusStoredObjectsTelemetryAdapter.create(),
  });

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.prisma })
    .withInfrastructure({
      storage: StoredObjectStoragePortAdapter.create({ runtime: storageRuntime, aws }),
      delivery: ApiStoredObjectDelivery.create(),
      uploadTokens: ApiStoredObjectUploadTokens.create(),
      idDeriver: { fromDigest: deriveStoredObjectId },
      maximumUploadBytes: MAXIMUM_UPLOAD_BYTES,
      uploadExpiryMs: UPLOAD_EXPIRY_MS,
      // The byte reads are the content-addressed store's: an avatar written
      // through it is an avatar this app's `readById` finds.
      files: bytes,
      owners: composeOwnerResolver(options, logger),
    })
    .withModule(storedObjectServer)
    .boot({ role: "api" });

  const app = runtime.module(storedObjectServer).provided;

  return {
    router: (mount) => createStoredObjectTrpcRouter(mount.runtime),
    app,
    restServices: { storedObjects: () => app },
    bytes,
    storage: { runtime: storageRuntime, aws },
    payloadStaging: storage.s3.bucket
      ? S3PayloadStagingAdapter.create({
          targets: ApiPayloadStagingS3Targets.create({
            targets,
            defaultBucket: storage.s3.bucket,
            aws,
          }),
        })
      : AbsentPayloadStagingAdapter.create(),
    close: async () => {
      await runtime.stop();
      await aws.close();
    },
  };
}

/**
 * A capability this deployment did not compose, refused by name. One class rather than
 * one per entry: the customer-facing distinction is WHICH capability is missing, and that
 * is the `capability` the message carries.
 */
class ApiStoredObjectUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiStoredObjectUnavailableError";
  }
}

/**
 * The delivery capability, absent. Minting one signs a URL against a policy
 * this process composes no signer for, so the operation refuses by name rather
 * than answering a link nothing honours.
 */
class ApiStoredObjectDelivery extends StoredObjectDeliveryPort {
  static create(): ApiStoredObjectDelivery {
    return new ApiStoredObjectDelivery();
  }

  async mint(): Promise<StoredObjectDeliveryCapability> {
    throw new ApiStoredObjectUnavailableError("Stored-object delivery");
  }
}

/** The upload-token codec, absent for the same reason the delivery policy is. */
class ApiStoredObjectUploadTokens extends StoredObjectUploadTokenPort {
  static create(): ApiStoredObjectUploadTokens {
    return new ApiStoredObjectUploadTokens();
  }

  async encode(): Promise<string> {
    throw new ApiStoredObjectUnavailableError("The stored-object upload ceremony");
  }

  async decode(): Promise<StoredObjectUploadTokenClaims> {
    throw new ApiStoredObjectUnavailableError("The stored-object upload ceremony");
  }
}

/**
 * The staging port a caller composed BEFORE the object store gets. The
 * execution graph is built ahead of the byte store, so the port is handed over
 * at composition time and resolved on first use rather than captured early.
 */
export class DeferredPayloadStagingAdapter extends PayloadStagingPort {
  static create(resolve: () => PayloadStagingPort): DeferredPayloadStagingAdapter {
    return new DeferredPayloadStagingAdapter(resolve);
  }

  private constructor(private readonly resolve: () => PayloadStagingPort) {
    super();
  }

  stage(
    input: Parameters<PayloadStagingPort["stage"]>[0],
  ): ReturnType<PayloadStagingPort["stage"]> {
    return this.resolve().stage(input);
  }
}

/** One configured endpoint, as this process hands it to the owner lookup. */
export type ApiStoredObjectOwnerInstance = Readonly<{
  target: string;
  client: unknown;
}>;

/**
 * The legacy id-only owner lookup, over every endpoint this process opened. Without a
 * ClickHouse connection the absence stands: an id with no table behind it resolves to
 * nothing, which is what an old trace's media link then reports.
 */
function composeOwnerResolver(
  options: StoredObjectFeatureCollaborators,
  logger: Pick<Logger, "warn">,
): StoredObjectOwnerResolver {
  const instances = options.clickHouseInstances;
  if (!instances) return ApiStoredObjectOwnerAbsence.create(logger);

  return StoredObjectOwnerLookupRuntimeAdapter.create({
    instanceDirectory: ApiStoredObjectOwnerInstanceDirectory.create(instances),
    telemetry: ApiStoredObjectOwnerLookupTelemetry.create(),
  }).resolver;
}

/** The endpoints the lookup fans out across, read at the lookup rather than captured. */
class ApiStoredObjectOwnerInstanceDirectory extends StoredObjectOwnerInstanceDirectoryPort {
  static create(
    instances: () => readonly ApiStoredObjectOwnerInstance[],
  ): ApiStoredObjectOwnerInstanceDirectory {
    return new ApiStoredObjectOwnerInstanceDirectory(instances);
  }

  private constructor(private readonly instances: () => readonly ApiStoredObjectOwnerInstance[]) {
    super();
  }

  async listInstances(): Promise<readonly StoredObjectOwnerClickHouseInstance[]> {
    return this.instances().map((instance) => ({
      target: instance.target,
      client: instance.client as StoredObjectOwnerClickHouseClient,
    }));
  }
}

/**
 * The lookup's own span attributes, which this process does not collect: the REST door
 * already records the delivery, and a second span per read would double-count it.
 */
class ApiStoredObjectOwnerLookupTelemetry extends StoredObjectOwnerLookupTelemetryPort {
  static create(): ApiStoredObjectOwnerLookupTelemetry {
    return new ApiStoredObjectOwnerLookupTelemetry();
  }

  withLookupSpan<Result>(
    _input: { id: string },
    operation: (span: {
      setAttribute(name: string, value: string | number | boolean): void;
    }) => Promise<Result>,
  ): Promise<Result> {
    return operation({ setAttribute: () => undefined });
  }
}

/**
 * No outbound proxy for this process's object storage. Stated rather than read: the API
 * process has no proxy configuration of its own yet, and inventing one from an unrelated
 * variable would route a tenant's bytes through a host nobody chose.
 */
class ApiNoOutboundProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

/**
 * Which S3 account a project's objects belong in. THE PROJECT'S ORGANIZATION IS RE-READ
 * ON EVERY RESOLUTION, deliberately.
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
   * The route's values first, then the deployment's, FIELD BY FIELD — which is how the
   * platform application resolved this and why it is not a whole-object fallback: a
   * tenant may be routed to its own endpoint while still reading with the deployment's
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

/**
 * The bucket and connection a project's STAGED payloads go to. The same
 * routing the object store uses, so a BYOC tenant's oversized body is parked
 * in the tenant's own bucket rather than the deployment's.
 */
class ApiPayloadStagingS3Targets extends PayloadStagingS3TargetPort {
  static create(options: {
    targets: ApiStoredObjectS3Targets;
    defaultBucket: string;
    aws: AwsClientProcessRuntime;
  }): ApiPayloadStagingS3Targets {
    return new ApiPayloadStagingS3Targets(options.targets, options.defaultBucket, options.aws);
  }

  private constructor(
    private readonly targets: ApiStoredObjectS3Targets,
    private readonly defaultBucket: string,
    private readonly aws: AwsClientProcessRuntime,
  ) {
    super();
  }

  async resolve(projectId: string): Promise<PayloadStagingS3Target> {
    const target = await this.targets.resolve(projectId);
    const bucket = (await this.targets.tryBucket(projectId)) ?? this.defaultBucket;
    return {
      bucket,
      client: new S3Client({
        ...this.aws.build({
          region: target.region,
          targetHost: target.endpoint ?? "s3.amazonaws.com",
          endpoint: target.endpoint,
          staticCredentials: target.credentials,
        }),
        forcePathStyle: true,
      }),
    };
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
      throw new ApiStoredObjectUnavailableError(
        "Stored object storage, because this deployment composed no ClickHouse connection,",
      );
    }
    return (await this.resolve(projectId)) as StoredObjectsClickHouseClient;
  }
}

/**
 * The legacy id-only owner lookup, absent. Resolving a project from an object id alone
 * means scanning every ClickHouse instance the deployment operates.
 */
class ApiStoredObjectOwnerAbsence extends StoredObjectOwnerResolver {
  static create(logger: Pick<Logger, "warn">): ApiStoredObjectOwnerAbsence {
    return new ApiStoredObjectOwnerAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  async tryResolve(input: { id: string }): Promise<{ projectId: string } | null> {
    this.logger.warn(
      { storedObjectId: input.id },
      "API process composed no stored-object owner directory: an id-only stored-object reference cannot be resolved to a project here.",
    );
    return null;
  }
}

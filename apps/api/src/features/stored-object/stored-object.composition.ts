/**
 * A project's own object store, composed as its own feature. `storedObjects.*` answers
 * one question — whether an externalized blob's ROW and its BYTES are both still there —
 * so a renderer can tell "the file is gone" from "that id never existed".
 */
import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  mintStoredObjectUri,
  StoredObjectOwnerResolver,
  StoredObjectService,
} from "@langwatch/stored-object-contract";
import {
  AzureBlobStoredObjectDriverAdapter,
  LocalFilesystemStoredObjectDriverAdapter,
  PrometheusStoredObjectsTelemetryAdapter,
  resolveAzureCredentials,
  S3StoredObjectDriverAdapter,
  StoredObjectApp,
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
  StoredObjectS3TargetPort,
  StoredObjectStorageRegistry,
  StoredObjectsClickHousePort,
  ClickHouseStoredObjectsRepository,
  StoredObjectsService,
  type StoredObjectS3Target,
  type StoredObjectsClickHouseClient,
} from "@langwatch/stored-object-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import type { ApiStoredObjectsConfigResolution } from "../../platform/config/api.config";
import { createStoredObjectTrpcRouter } from "./stored-object-trpc.mount";

/** Reports the one capability this feature can be composed without. */
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

/** Everything the object store is composed from. */
export type StoredObjectFeatureCollaborators = Readonly<{
  prisma: ApiTrpcInfrastructure["prisma"];
  /**
   * The routed ClickHouse connection the object table is read through, or null
   * on a deployment that composed none.
   */
  resolveClickHouseClient: ((projectId: string) => Promise<unknown>) | null;
  /** The object storage this deployment addresses its bytes in. */
  storage: ApiStoredObjectsConfigResolution;
  report?: ApiStoredObjectAbsenceReport;
}>;

/** The namespace, the `ctx.app` slice, and the byte store the doors take. */
export type ComposedStoredObjectFeature = Readonly<{
  /** `storedObjects.*`. Takes no ports: the probe reads the slice and nothing else. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createStoredObjectTrpcRouter>;
  /** For `ctx.app.storedObjectApp`. */
  app: StoredObjectApp;
  /**
   * The CONTENT-ADDRESSED store itself, published for the one caller that needs to write
   * bytes rather than read them: the scenario-event door, whose inline media the trace
   * vertical's extractor externalises.
   */
  bytes: StoredObjectsService;
  /** Released with the process: the pooled outbound handlers the S3 clients share. */
  close(): Promise<void>;
}>;

/** Composes the object store over this process's own graph. */
export function composeStoredObjectFeature(
  options: StoredObjectFeatureCollaborators,
): ComposedStoredObjectFeature {
  const composed = composeStoredObjects(options, createLogger("langwatch:api:stored-object"));

  return {
    router: (mount) => createStoredObjectTrpcRouter(mount),
    app: composed.app,
    bytes: composed.bytes,
    close: () => composed.close(),
  };
}

/**
 * The object store on a process that composed no backend to address bytes in.
 */
export function refusingStoredObjectFeature(): ComposedStoredObjectFeature {
  const refuse = <T>(): T =>
    new Proxy(
      {},
      {
        get: () => (): never => {
          throw new ApiStoredObjectUnavailableError("The object store");
        },
        has: () => true,
      },
    ) as T;

  return {
    router: (mount) => createStoredObjectTrpcRouter(mount),
    app: refuse<StoredObjectApp>(),
    bytes: refuse<StoredObjectsService>(),
    close: async () => undefined,
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

// ---------------------------------------------------------------------------
// Stored objects
// ---------------------------------------------------------------------------

/**
 * The content-addressed object store, over this process's routed ClickHouse connection
 * and its own byte backend.
 */
function composeStoredObjects(
  options: StoredObjectFeatureCollaborators,
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
    repository: ClickHouseStoredObjectsRepository.create(
      ApiStoredObjectsClickHouse.create(options.resolveClickHouseClient),
    ),
    registry: (projectId: string) =>
      new StoredObjectStorageRegistry({
        s3: S3StoredObjectDriverAdapter.create({
          projectId,
          targets,
          policy: { build: (input) => aws.build(input) },
        }),
        file: LocalFilesystemStoredObjectDriverAdapter.create(),
        // A FACTORY rather than a driver, which is the registry's own Azure policy: a
        // deployment that never reads an `azure-blob://` URI never resolves credentials,
        // so an install with no Azure block configured is not made to fail at boot over a
        // backend it does not use. The resolver's `purpose: "read"` is what lets an
        // operator who migrated OFF Azure keep reading what was written before.
        "azure-blob": () =>
          AzureBlobStoredObjectDriverAdapter.create(
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
    telemetry: PrometheusStoredObjectsTelemetryAdapter.create(),
  });

  return {
    app: StoredObjectApp.create({
      // The byte reads are the moved service's; the PORTABLE capability — the upload
      // ceremony, the delivery capability, the metadata read — is the canonical Postgres
      // store's, which this process composes no token signer or delivery policy for.
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

  async resolve(input: { id: string }): Promise<{ projectId: string } | null> {
    this.logger.warn(
      { storedObjectId: input.id },
      "API process composed no stored-object owner directory: an id-only stored-object reference cannot be resolved to a project here.",
    );
    return null;
  }
}

/**
 * The PORTABLE stored-object capability, absent. The upload ceremony, the delivery
 * capability and the metadata read belong to the canonical Postgres store, and this
 * process composes neither the token signer nor the delivery policy that store takes.
 */
class ApiStoredObjectPortableAbsence extends StoredObjectService {
  static create(): ApiStoredObjectPortableAbsence {
    return new ApiStoredObjectPortableAbsence();
  }

  private refuse(capability: string): never {
    throw new ApiStoredObjectUnavailableError(
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

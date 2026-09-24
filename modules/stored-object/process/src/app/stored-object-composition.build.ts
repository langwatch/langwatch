/**
 * Builds {@link StoredObjectInfrastructure} from the deleted api composition.
 * Omits legacy owner lookup (see stored-object-composition-green).
 */
import { AwsClientProcessRuntime, OutboundProxyResolver } from "@langwatch/aws-client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { ResourceOwnership } from "@langwatch/kernel";
import type { Logger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import {
  mintStoredObjectUri,
  StoredObjectOwnerResolver,
  StoredObjectCapabilityUnavailableError,
  StoredObjectNotFoundError,
  type StoredObjectDeliveryCapability,
  type StoredObjectServerConfig,
} from "@langwatch/stored-object-contract";

import { AzureBlobStoredObjectDriverAdapter } from "../repositories/azure/azure.stored-object-blob.repository.ts";
import { ClickHouseStoredObjectsRepository } from "../repositories/clickhouse/stored-objects.repository.ts";
import { StoredObjectBlobFilesystemRepository } from "../repositories/filesystem/filesystem.stored-object-blob.repository.ts";
import { PrismaStoredObjectProjectOrganizationRepository } from "../repositories/prisma/prisma.stored-object-project-organization.repository.ts";
import { StoredObjectBlobS3Repository } from "../repositories/s3/s3.stored-object-blob.repository.ts";
import type { StoredObjectStorageDriver } from "../repositories/stored-object-blob.repository.ts";
import { AzureBlobCredentialsAdapter } from "../services/azure-blob-credentials.service.ts";
import { PrometheusStoredObjectsTelemetryAdapter } from "../services/prometheus.stored-objects-telemetry.service.ts";
import {
  StoredObjectDestinationPolicyAdapter,
  StoredObjectProjectS3Config,
  type StoredObjectProjectBucket,
} from "../services/stored-object-destination-policy.service.ts";
import { StoredObjectStorageRegistryAdapter } from "../services/stored-object-storage-registry.service.ts";
import { StoredObjectStorageRuntimeAdapter } from "../services/stored-object-storage-runtime.service.ts";
import { StoredObjectStorageService } from "../services/stored-object-storage.service.ts";
import { StoredObjectsService, deriveStoredObjectId } from "../services/stored-objects.service.ts";
import type { StoredObjectInfrastructure } from "./stored-object.app.ts";
import {
  StoredObjectDelivery,
  StoredObjectUploadTokenCodec,
  type StoredObjectS3Target,
  type StoredObjectS3TargetResolver,
  type StoredObjectsClickHouse,
  type StoredObjectsClickHouseClient,
} from "./stored-object.members.ts";

/** What `buildStoredObjectInfrastructure` reads off the process's own members. */
export type StoredObjectProcessMembers = Readonly<{
  prisma: ProcessMembers["prisma"];
  clickhouse: ClickHouseQueryClient;
  logger: Logger;
  secrets: ProcessMembers["secrets"];
  /** The process's own fact (§6), for the Azure insecure-token-endpoint gate. */
  nodeEnvironment: string | undefined;
}>;

/**
 * The deployment's own S3 credentials, resolved once through the secrets
 * member (ADR-132) rather than read from config — a per-org route's own pair
 * still takes precedence, per field, ahead of these.
 */
type StoredObjectS3DeploymentSecrets = Readonly<{
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  sessionToken: string | undefined;
}>;

/** These match deleted composition; direct upload is not composed here. */
const MAXIMUM_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_EXPIRY_MS = 300_000;

/** The documented single-replica fallback root, when no other is configured. */
const DEFAULT_LOCAL_FILESYSTEM_ROOT = "/var/lib/langwatch/objects";

/**
 * The delivery capability, absent. Minting one signs a URL against a policy
 * this process composes no signer for, so the operation refuses by name
 * rather than answering a link nothing honours.
 */
class UnavailableStoredObjectDelivery extends StoredObjectDelivery {
  async mint(): Promise<StoredObjectDeliveryCapability> {
    throw new StoredObjectCapabilityUnavailableError("Stored-object delivery");
  }
}

/** The upload-token codec, absent for the same reason the delivery policy is. */
class UnavailableStoredObjectUploadTokens extends StoredObjectUploadTokenCodec {
  async encode(): Promise<string> {
    throw new StoredObjectCapabilityUnavailableError("The stored-object upload ceremony");
  }

  async decode(): Promise<never> {
    throw new StoredObjectCapabilityUnavailableError("The stored-object upload ceremony");
  }
}

/**
 * No proxy is inferred: unrelated variables must not route tenant bytes
 * through an unchosen host.
 */
class NoOutboundProxyResolver extends OutboundProxyResolver {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

/**
 * One organization's own S3 account, keyed by organization id. No config
 * primitive today declares a dynamic, tenant-keyed env-name set (see the
 * handoff) — always empty until that primitive lands.
 */
type StoredObjectS3RouteTable = Readonly<
  Record<
    string,
    Readonly<{
      endpoint?: string;
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    }>
  >
>;

/**
 * Which S3 account a project's objects belong in. THE PROJECT'S ORGANIZATION
 * IS RE-READ ON EVERY RESOLUTION, deliberately.
 */
class StoredObjectS3Targets
  extends StoredObjectProjectS3Config
  implements StoredObjectS3TargetResolver
{
  private readonly projectOrganizations: PrismaStoredObjectProjectOrganizationRepository;
  private readonly storage: StoredObjectServerConfig;
  private readonly routes: StoredObjectS3RouteTable;
  private readonly deploymentSecrets: StoredObjectS3DeploymentSecrets;

  constructor(deps: {
    projectOrganizations: PrismaStoredObjectProjectOrganizationRepository;
    storage: StoredObjectServerConfig;
    routes: StoredObjectS3RouteTable;
    deploymentSecrets: StoredObjectS3DeploymentSecrets;
  }) {
    super();
    this.projectOrganizations = deps.projectOrganizations;
    this.storage = deps.storage;
    this.routes = deps.routes;
    this.deploymentSecrets = deps.deploymentSecrets;
  }

  /**
   * The route's values first, then the deployment's, FIELD BY FIELD — a
   * tenant may be routed to its own endpoint while still reading with the
   * deployment's credentials for any field its own route leaves unset.
   */
  async resolve(projectId: string): Promise<StoredObjectS3Target> {
    const route = await this.tryRoute(projectId);
    const { s3 } = this.storage;

    const endpoint = route?.endpoint ?? s3.endpoint;
    const accessKeyId = route?.accessKeyId ?? this.deploymentSecrets.accessKeyId;
    const secretAccessKey = route?.secretAccessKey ?? this.deploymentSecrets.secretAccessKey;
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
              ...(this.deploymentSecrets.sessionToken
                ? { sessionToken: this.deploymentSecrets.sessionToken }
                : {}),
            },
          }
        : {}),
    };
  }

  /** The bucket half of the same answer, for the destination policy. */
  async resolveBucket(projectId: string): Promise<StoredObjectProjectBucket> {
    const route = await this.tryRoute(projectId);
    return route?.bucket ? { kind: "byoc", bucket: route.bucket } : { kind: "platform" };
  }

  private async tryRoute(projectId: string) {
    if (Object.keys(this.routes).length === 0) return null;
    const organizationId = await this.projectOrganizations.findOrganizationId(projectId);
    if (!organizationId) return null;
    return this.routes[organizationId] ?? null;
  }
}

/**
 * The routed ClickHouse member, adapted to the low-level driver shape the
 * stored-objects repository asks for. One tenant per resolution, exactly as
 * the table's own rule requires (every statement names its tenant).
 */
class MemberStoredObjectsClickHouseClient implements StoredObjectsClickHouseClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings
        ? { settings: input.clickhouse_settings as Record<string, string | number> }
        : {}),
    });
  }

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
  }): Promise<{ json<Result>(): Promise<Result[]> }> {
    const result = await this.clickhouse.query({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
    });
    return { json: async <Result>() => result.rows as Result[] };
  }

  async exec(input: {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.clickhouse.command({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      ...(input.clickhouse_settings
        ? { settings: input.clickhouse_settings as Record<string, string | number> }
        : {}),
    });
  }
}

/** Resolves the routed ClickHouse client one project's stored-object rows live on. */
class MemberStoredObjectsClickHouse implements StoredObjectsClickHouse {
  constructor(private readonly clickhouse: ClickHouseQueryClient) {}

  async resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient> {
    return new MemberStoredObjectsClickHouseClient(this.clickhouse, projectId);
  }
}

/**
 * The legacy id-only owner lookup, absent. Resolving a project from an object
 * id alone means scanning every ClickHouse instance the deployment operates;
 * this process composes no such directory (tracked gap, see the handoff).
 */
class StoredObjectOwnerAbsence extends StoredObjectOwnerResolver {
  constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  async getOwner(input: { id: string }): Promise<{ projectId: string }> {
    this.logger.warn(
      { storedObjectId: input.id },
      "API process composed no stored-object owner directory: an id-only stored-object reference cannot be resolved to a project here.",
    );
    throw new StoredObjectNotFoundError();
  }
}

/** Builds the {@link StoredObjectInfrastructure} `StoredObjectApp.create` composes over. */
export function buildStoredObjectInfrastructure(input: {
  members: StoredObjectProcessMembers;
  config: StoredObjectServerConfig;
  resources: ResourceOwnership;
}): StoredObjectInfrastructure {
  const { members, config: storage } = input;
  // No config primitive today declares a dynamic, tenant-keyed env-name set
  // (config-schema-nuke-batch-c handoff) — always empty until one lands.
  const routes: StoredObjectS3RouteTable = {};

  const aws = AwsClientProcessRuntime.create({ outboundProxy: new NoOutboundProxyResolver() });
  input.resources.own("api stored-object aws client runtime", () => aws.close());

  const deploymentS3Secrets: StoredObjectS3DeploymentSecrets = {
    accessKeyId: members.secrets.find("S3_ACCESS_KEY_ID"),
    secretAccessKey: members.secrets.find("S3_SECRET_ACCESS_KEY"),
    sessionToken: members.secrets.find("S3_SESSION_TOKEN"),
  };
  const azureAccountKey = members.secrets.find("AZURE_BLOB_ACCOUNT_KEY");

  const targets = new StoredObjectS3Targets({
    projectOrganizations: PrismaStoredObjectProjectOrganizationRepository.create(members.prisma),
    storage,
    routes,
    deploymentSecrets: deploymentS3Secrets,
  });
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
    projects: targets,
  });

  // ONE set of driver factories, read by both the indexed object store below
  // and the project-keyed runtime published beside it, so a consumer that
  // writes bytes without a row lands in the same place a stored object does.
  const s3ForProject = (projectId: string, awsRuntime: AwsClientProcessRuntime) =>
    StoredObjectBlobS3Repository.create({
      projectId,
      targets,
      policy: { build: (buildInput) => awsRuntime.build(buildInput) },
    });
  const fileForProject = () => StoredObjectBlobFilesystemRepository.create();
  // A FACTORY rather than a driver, which is the registry's own Azure policy: a
  // deployment that never reads an `azure-blob://` URI never resolves credentials,
  // so an install with no Azure block configured is not made to fail at boot over a
  // backend it does not use. The resolver's `purpose: "read"` is what lets an
  // operator who migrated OFF Azure keep reading what was written before.

  // Fail-closed: the insecure-endpoint escape hatch never activates in
  // production, whatever this variable is set to.
  const allowInsecureTokenEndpointForTests =
    members.nodeEnvironment !== "production" &&
    storage.azure.allowInsecureTokenEndpointForTests === "1";
  const azureForProject = (): StoredObjectStorageDriver =>
    AzureBlobStoredObjectDriverAdapter.create(
      AzureBlobCredentialsAdapter.resolveAzureCredentials({
        config: {
          ...storage.azure,
          accountKey: azureAccountKey,
          allowInsecureTokenEndpointForTests,
        },
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
      new MemberStoredObjectsClickHouse(members.clickhouse),
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

  return {
    storage: StoredObjectStorageService.create({ runtime: storageRuntime, aws }),
    delivery: new UnavailableStoredObjectDelivery(),
    uploadTokens: new UnavailableStoredObjectUploadTokens(),
    idDeriver: { fromDigest: deriveStoredObjectId },
    maximumUploadBytes: MAXIMUM_UPLOAD_BYTES,
    uploadExpiryMs: UPLOAD_EXPIRY_MS,
    // The byte reads are the content-addressed store's: an avatar written
    // through it is an avatar this app's `readById` finds.
    files: bytes,
    owners: new StoredObjectOwnerAbsence(members.logger),
  } satisfies StoredObjectInfrastructure;
}

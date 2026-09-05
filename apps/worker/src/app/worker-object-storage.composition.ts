import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ResourceScope } from "@langwatch/runtime-composition";
import {
  AzureBlobStoredObjectDriverAdapter,
  resolveAzureCredentials,
} from "@langwatch/stored-object-server";
import type {
  StoredObjectStorageDriver,
  StoredObjectStorageRuntimeAdapter,
} from "@langwatch/stored-object-server";
import {
  WorkerAzureStorageFactoryPort,
  WorkerProjectS3SourcePort,
  WorkerStoredObjectStorageRuntimeFactory,
  type WorkerProjectS3Target,
} from "../platform/infrastructure/worker-stored-object-storage.adapter";
import type {
  WorkerConfig,
  WorkerOutboundProxyConfig,
  WorkerStorageConfig,
} from "../platform/config/worker.config";

/** The one table BYOC routing reads, named here and nowhere above it. */
export type WorkerProjectStorageDatabase = Pick<PrismaClient, "project">;

export type WorkerObjectStorage = {
  runtime: StoredObjectStorageRuntimeAdapter;
  aws: AwsClientProcessRuntime;
  /**
   * The BYOC lookup, exposed because two consumers need the tenant's ENDPOINT and CREDENTIALS and
   * not only its bucket: the destination policy answers where an object belongs, and an S3 client
   * still has to be built to reach it.
   */
  projects: WorkerProjectS3SourcePort;
  /** The shared bucket, for a project with no route of its own. */
  globalS3?: WorkerProjectS3Target;
  /**
   * The `AZURE_BLOB_*` block this process read, exposed alongside the runtime
   * so a second consumer (dataset normalization) can build its OWN Azure
   * driver rather than reaching through the registry's scheme dispatch.
   */
  azureConfig: WorkerStorageConfig["azure"];
};

/**
 * This deployment's Azure Blob driver, or undefined when no account is configured. Shared by the
 * general object-storage registry (narrowed to `StoredObjectStorageDriver`) and dataset
 * normalization (which keeps the concrete type for `head()`).
 */
export function createWorkerAzureBlobDriver(
  azure: WorkerStorageConfig["azure"],
): AzureBlobStoredObjectDriverAdapter | undefined {
  if (!azure.accountName) return undefined;
  return AzureBlobStoredObjectDriverAdapter.create(
    resolveAzureCredentials({ config: azure, purpose: "write", identity: azure.identity }),
  );
}

/**
 * Lazy so an inactive or BYOC-first deployment never resolves credentials —
 * matching the registry's own Azure policy (`createDriver` is a factory the
 * general path invokes only when an `azure-blob://` URI is actually touched).
 */
class WorkerAzureStorageAdapter extends WorkerAzureStorageFactoryPort {
  static create(azure: WorkerStorageConfig["azure"]): WorkerAzureStorageAdapter {
    return new WorkerAzureStorageAdapter(azure);
  }

  private constructor(private readonly azure: WorkerStorageConfig["azure"]) {
    super();
  }

  resolve(): { accountName: string; container: string } {
    if (!this.azure.accountName || !this.azure.container) {
      throw new Error(
        "Azure object storage requires AZURE_BLOB_ACCOUNT_NAME and AZURE_BLOB_CONTAINER",
      );
    }
    return { accountName: this.azure.accountName, container: this.azure.container };
  }

  createDriver(): StoredObjectStorageDriver | undefined {
    return createWorkerAzureBlobDriver(this.azure);
  }
}

/**
 * The object storage this process reads and writes through. IT IS NOT OPTIONAL FOR TRACE, and that
 * is what makes it a composition of its own rather than a field on one.
 * `command:recordSpan` resolves the ADR-022 claim check for any span whose
 */
export function createWorkerObjectStorage(options: {
  config: WorkerConfig;
  database: WorkerProjectStorageDatabase;
  resources?: ResourceScope;
}): WorkerObjectStorage {
  const { storage } = options.config.infrastructure;
  const aws = AwsClientProcessRuntime.create({
    outboundProxy: WorkerObjectStorageProxyResolver.create(
      options.config.infrastructure.outboundProxy,
    ),
  });
  options.resources?.own("worker object storage aws clients", () => aws.close());

  const globalS3 = globalS3Target(options.config);
  const projects = WorkerProjectS3SourceAdapter.create({
    database: options.database,
    routes: storage.dataplaneS3,
  });
  const azure =
    storage.backend === "azure" ? WorkerAzureStorageAdapter.create(storage.azure) : undefined;
  const runtime = WorkerStoredObjectStorageRuntimeFactory.create({
    config: {
      backend: storage.backend,
      localFilesystemRoot: storage.localFilesystemRoot,
      ...(globalS3 ? { globalS3 } : {}),
      ...(azure ? { azure } : {}),
    },
    projects,
  }).createRuntime();

  return { runtime, aws, projects, azureConfig: storage.azure, ...(globalS3 ? { globalS3 } : {}) };
}

/**
 * Which S3 account a project's objects belong in. THE PROJECT'S ORGANIZATION IS RE-READ ON EVERY
 * RESOLUTION, deliberately.
 */
class WorkerProjectS3SourceAdapter extends WorkerProjectS3SourcePort {
  static create(options: {
    database: WorkerProjectStorageDatabase;
    routes: ReadonlyMap<
      string,
      { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }
    >;
  }): WorkerProjectS3SourceAdapter {
    return new WorkerProjectS3SourceAdapter(options.database, options.routes);
  }

  private constructor(
    private readonly database: WorkerProjectStorageDatabase,
    private readonly routes: ReadonlyMap<
      string,
      { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }
    >,
  ) {
    super();
  }

  async tryGet(projectId: string): Promise<WorkerProjectS3Target | null> {
    if (this.routes.size === 0) return null;

    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project) return null;

    const route = this.routes.get(project.team.organizationId);
    if (!route) return null;

    return {
      bucket: route.bucket,
      endpoint: route.endpoint,
      credentials: {
        accessKeyId: route.accessKeyId,
        secretAccessKey: route.secretAccessKey,
      },
    };
  }
}

class WorkerObjectStorageProxyResolver extends OutboundProxyResolverPort {
  static create(config: WorkerOutboundProxyConfig): WorkerObjectStorageProxyResolver {
    return new WorkerObjectStorageProxyResolver(config);
  }

  private constructor(private readonly config: WorkerOutboundProxyConfig) {
    super();
  }

  tryResolveForHost(hostname: string): string | undefined {
    const proxy = this.config.https ?? this.config.http;
    if (!proxy || isProxyBypassed(this.config.noProxy, hostname)) return undefined;
    return proxy;
  }
}

function globalS3Target(config: WorkerConfig): WorkerProjectS3Target | undefined {
  const { s3 } = config.infrastructure.storage;
  if (!s3.bucket?.trim()) return undefined;

  const credentials =
    s3.accessKeyId && s3.secretAccessKey
      ? {
          accessKeyId: s3.accessKeyId,
          secretAccessKey: s3.secretAccessKey,
          ...(s3.sessionToken ? { sessionToken: s3.sessionToken } : {}),
        }
      : undefined;

  return {
    bucket: s3.bucket,
    ...(s3.endpoint !== undefined ? { endpoint: s3.endpoint } : {}),
    ...(s3.region !== undefined ? { region: s3.region } : {}),
    ...(credentials ? { credentials } : {}),
  };
}

function isProxyBypassed(noProxy: string | undefined, targetHost: string): boolean {
  if (!noProxy) return false;

  const host = targetHost.toLowerCase().replace(/:\d+$/, "");
  return noProxy
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const bare = entry.startsWith(".") ? entry.slice(1) : entry;
      return host === bare || host.endsWith(`.${bare}`);
    });
}

import { OutboundProxyResolverPort } from "@langwatch/aws-client";
import type { WorkerInfrastructureCompositionOptions } from "./worker-production.composition";
import type { WorkerConfig, WorkerOutboundProxyConfig } from "../platform/config/worker.config";
import {
  WorkerAzureStorageFactoryPort,
  WorkerProjectS3SourcePort,
  WorkerStoredObjectStorageRuntimeFactory,
  type WorkerProjectS3Target,
} from "../platform/infrastructure/worker-stored-object-storage.adapter";

export type WorkerPrivateInfrastructurePorts = Readonly<{
  projects: WorkerProjectS3SourcePort;
  azure?: WorkerAzureStorageFactoryPort;
}>;

/**
 * Maps the Worker-private boot projection into the process infrastructure
 * graph. The physical executable supplies project BYOC and Azure capabilities;
 * this root never imports the legacy application graph or enables consumers.
 */
export function createWorkerPrivateInfrastructureComposition(options: {
  config: WorkerConfig;
  ports: WorkerPrivateInfrastructurePorts;
}): WorkerInfrastructureCompositionOptions {
  return {
    redis: options.config.infrastructure.redis,
    queuePolicy: options.config.infrastructure.groupQueue,
    outboundProxy: WorkerOutboundProxyResolver.create(options.config.infrastructure.outboundProxy),
    storedObjectStorage: WorkerStoredObjectStorageRuntimeFactory.create({
      config: {
        backend: options.config.infrastructure.storage.backend,
        localFilesystemRoot: options.config.infrastructure.storage.localFilesystemRoot,
        globalS3: globalS3Target(options.config),
        ...(options.ports.azure ? { azure: options.ports.azure } : {}),
      },
      projects: options.ports.projects,
    }),
  };
}

class WorkerOutboundProxyResolver extends OutboundProxyResolverPort {
  static create(config: WorkerOutboundProxyConfig): WorkerOutboundProxyResolver {
    return new WorkerOutboundProxyResolver(config);
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

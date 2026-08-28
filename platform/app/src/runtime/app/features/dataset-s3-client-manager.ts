import { S3Client } from "@aws-sdk/client-s3";
import { DatasetS3ClientResolver, type DatasetS3ClientLease } from "@langwatch/dataset-server";
import type { AppAwsClientConfiguration } from "~/runtime/app/aws-client.composition";
import { resolveS3ClientTarget, type ResolvedS3ClientTarget } from "~/server/storage";

type ManagedClient = {
  client: S3Client;
  bucket: string;
  fingerprint: string;
  activeLeases: number;
  superseded: boolean;
};

export type DatasetS3ClientConfigBuilder = AppAwsClientConfiguration["build"];

export type AppDatasetS3ClientManagerOptions = {
  resolveTarget?: (projectId: string) => Promise<ResolvedS3ClientTarget>;
  /** Process-owned AWS transport graph composed from validated proxy policy. */
  aws?: Pick<AppAwsClientConfiguration, "build">;
  /** Compatibility seam for isolated tasks and unit tests. */
  buildClientConfig?: DatasetS3ClientConfigBuilder;
};

/**
 * Process-owned Dataset S3 client manager. It resolves the tenant's current
 * target for every operation, retaining an SDK client only while the opaque
 * destination/identity fingerprint remains unchanged.
 */
export class AppDatasetS3ClientManager extends DatasetS3ClientResolver {
  static create(options: AppDatasetS3ClientManagerOptions = {}): AppDatasetS3ClientManager {
    const aws = options.aws;
    const buildClientConfig = aws
      ? (input: Parameters<DatasetS3ClientConfigBuilder>[0]) => aws.build(input)
      : options.buildClientConfig;
    if (!buildClientConfig) {
      throw new Error("Dataset S3 clients require a process-owned AWS configuration.");
    }
    return new AppDatasetS3ClientManager(
      options.resolveTarget ?? resolveS3ClientTarget,
      buildClientConfig,
    );
  }

  private readonly clients = new Map<string, ManagedClient>();
  private readonly retiredClients = new Set<ManagedClient>();
  private readonly resolutionChains = new Map<string, Promise<void>>();
  private closing = false;

  private constructor(
    private readonly resolveTarget: (projectId: string) => Promise<ResolvedS3ClientTarget>,
    private readonly buildClientConfig: DatasetS3ClientConfigBuilder,
  ) {
    super();
  }

  acquire(projectId: string): Promise<DatasetS3ClientLease> {
    const prior = this.resolutionChains.get(projectId) ?? Promise.resolve();
    const acquisition = prior.then(() => this.acquireResolved(projectId));
    const settled = acquisition.then(
      () => void 0,
      () => void 0,
    );
    this.resolutionChains.set(projectId, settled);
    void settled.finally(() => {
      if (this.resolutionChains.get(projectId) === settled) {
        this.resolutionChains.delete(projectId);
      }
    });
    return acquisition;
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const activeClients = [...this.clients.values(), ...this.retiredClients];
    this.clients.clear();
    this.retiredClients.clear();
    this.resolutionChains.clear();
    for (const client of activeClients) {
      client.client.destroy();
    }
  }

  private async acquireResolved(projectId: string): Promise<DatasetS3ClientLease> {
    if (this.closing) {
      throw new Error("Dataset S3 client manager is closed");
    }

    const target = await this.resolveTarget(projectId);
    if (this.closing) {
      throw new Error("Dataset S3 client manager is closed");
    }

    const current = this.clients.get(projectId);
    const client =
      current?.fingerprint === target.fingerprint
        ? current
        : this.replaceClient(projectId, target, current);
    client.activeLeases += 1;

    let released = false;
    return {
      s3Client: client.client,
      s3Bucket: client.bucket,
      release: () => {
        if (released) return;
        released = true;
        client.activeLeases -= 1;
        if (client.superseded && client.activeLeases === 0) {
          this.destroyRetiredClient(client);
        }
      },
    };
  }

  private replaceClient(
    projectId: string,
    target: ResolvedS3ClientTarget,
    current: ManagedClient | undefined,
  ): ManagedClient {
    const client = new S3Client({
      ...this.buildClientConfig({
        ...(target.region !== undefined ? { region: target.region } : {}),
        targetHost: target.endpoint ?? "s3.amazonaws.com",
        ...(target.endpoint ? { endpoint: target.endpoint } : {}),
        ...(target.credentials ? { staticCredentials: target.credentials } : {}),
      }),
      forcePathStyle: true,
    });
    const replacement: ManagedClient = {
      client,
      bucket: target.s3Bucket,
      fingerprint: target.fingerprint,
      activeLeases: 0,
      superseded: false,
    };
    this.clients.set(projectId, replacement);

    if (current) {
      current.superseded = true;
      this.retiredClients.add(current);
      if (current.activeLeases === 0) {
        this.destroyRetiredClient(current);
      }
    }

    return replacement;
  }

  private destroyRetiredClient(client: ManagedClient): void {
    this.retiredClients.delete(client);
    client.client.destroy();
  }
}

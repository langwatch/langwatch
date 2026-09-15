// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { GovernanceInternalProject } from "@langwatch/project-server";
import {
  createIngestionPullWorker,
  type GovernanceHttpClient,
  type GovernanceObjectStore,
  type GovernanceOcsfEventSink,
  type IngestionPullDiagnosticsSink,
  type IngestionPullSource,
  type IngestionPullWorkerService,
  type PulledUsageEntitlements,
  type PulledUsageRateReader,
  type GovernanceOcsfEventInput,
  type GovernanceHttpResponse,
  type GovernanceObjectStorageCredentials,
  type PulledUsageRateInput,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { AppGovernanceOcsfEventsAdapter } from "./governance-ocsf-events.clickhouse.repository.ts";
import {
  AppGovernanceEncryption,
  type GovernanceEncryption,
} from "./governance-infrastructure.adapter.ts";

const MAX_S3_FILES = 100;
const MAX_S3_PAGES = 50;

type GovernanceAwsClientConfigInput = {
  region?: string;
  targetHost: string;
  endpoint?: string;
  staticCredentials?: GovernanceObjectStorageCredentials;
};

type GovernanceAwsClientConfig = S3ClientConfig;

export type GovernanceHttpRequest = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  followRedirects?: boolean;
};

type GovernanceObjectStorageListInput = {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string;
  startAfter?: string;
  credentials: GovernanceObjectStorageCredentials;
  signal?: AbortSignal;
  limit: number;
};

type GovernanceObjectStorageReadTextInput = {
  bucket: string;
  key: string;
  region: string;
  endpoint?: string;
  credentials: GovernanceObjectStorageCredentials;
  signal?: AbortSignal;
  maxBytes: number;
};

/** Complete API-host boundary for one ingestion-pull worker installation. */
export abstract class GovernanceIngestionPullHost {
  abstract fetch(url: string, init: GovernanceHttpRequest): Promise<GovernanceHttpResponse>;
  abstract ratePulledUsage(input: PulledUsageRateInput): {
    costNanoUsd: number;
    rateVersion: string;
  };
  abstract isPulledUsageCostEnabled(organizationId: string): Promise<boolean>;
  abstract capture(error: Error, context: Record<string, unknown>): void;
  abstract buildAwsClientConfig(input: GovernanceAwsClientConfigInput): GovernanceAwsClientConfig;
  abstract readonly encryption: GovernanceEncryption;
}

class AppGovernanceHttp implements GovernanceHttpClient {
  private constructor(private readonly host: GovernanceIngestionPullHost) {}

  static create(host: GovernanceIngestionPullHost): AppGovernanceHttp {
    return new AppGovernanceHttp(host);
  }

  async fetch(url: string, init: GovernanceHttpRequest) {
    return this.host.fetch(url, init);
  }
}

export class AppGovernanceObjectStorage implements GovernanceObjectStore {
  private constructor(private readonly host: GovernanceIngestionPullHost) {}

  static create(host: GovernanceIngestionPullHost): AppGovernanceObjectStorage {
    return new AppGovernanceObjectStorage(host);
  }

  async list(
    input: GovernanceObjectStorageListInput,
  ): Promise<{ keys: string[]; isTruncated: boolean }> {
    return this.withClient(input, async (client) => {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      let pages = 0;
      do {
        pages += 1;
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: input.prefix,
            StartAfter: continuationToken ? undefined : input.startAfter,
            ContinuationToken: continuationToken,
            MaxKeys: 1_000,
          }),
          { abortSignal: input.signal },
        );
        for (const object of response.Contents ?? []) {
          if (object.Key) keys.push(object.Key);
          if (keys.length >= Math.min(input.limit, MAX_S3_FILES)) {
            return { keys, isTruncated: true };
          }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken && pages < MAX_S3_PAGES);
      // A page budget exhausted with a token still in hand is truncated too.
      return { keys, isTruncated: continuationToken !== undefined };
    });
  }

  async readText(input: GovernanceObjectStorageReadTextInput): Promise<string> {
    return this.withClient(input, async (client) => {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { abortSignal: input.signal },
      );
      if (!response.Body) {
        throw new Error(`empty body for s3://${input.bucket}/${input.key}`);
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      if (!(Symbol.asyncIterator in response.Body)) {
        throw new Error(`streaming body unavailable for s3://${input.bucket}/${input.key}`);
      }
      for await (const chunk of response.Body) {
        if (input.signal?.aborted) {
          throw new Error(`aborted while reading s3://${input.bucket}/${input.key}`);
        }
        totalBytes += chunk.byteLength;
        if (totalBytes > input.maxBytes) {
          throw new Error(
            `file exceeds ${input.maxBytes} bytes: s3://${input.bucket}/${input.key}`,
          );
        }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    });
  }

  private async withClient<T>(
    input: {
      region: string;
      endpoint?: string;
      credentials: GovernanceObjectStorageCredentials;
    },
    operation: (client: S3Client) => Promise<T>,
  ): Promise<T> {
    const { accessKeyId, secretAccessKey, sessionToken } = input.credentials;
    const client = new S3Client({
      ...this.host.buildAwsClientConfig({
        region: input.region,
        endpoint: input.endpoint,
        targetHost: input.endpoint ?? defaultS3Host(input.region),
        staticCredentials: { accessKeyId, secretAccessKey, sessionToken },
      }),
      forcePathStyle: input.endpoint !== undefined,
    });
    try {
      return await operation(client);
    } finally {
      client.destroy();
    }
  }
}

function defaultS3Host(region: string): string {
  const suffix = region.startsWith("cn-") ? ".amazonaws.com.cn" : ".amazonaws.com";
  return `s3.${region}${suffix}`;
}

class AppGovernanceOcsfEventSink implements GovernanceOcsfEventSink {
  private constructor(private readonly events: AppGovernanceOcsfEventsAdapter | undefined) {}

  static create(events: AppGovernanceOcsfEventsAdapter | undefined): AppGovernanceOcsfEventSink {
    return new AppGovernanceOcsfEventSink(events);
  }

  insertEvent(input: GovernanceOcsfEventInput): Promise<void> {
    if (!this.events) {
      throw new Error(
        "ClickHouse client is not available — check ClickHouse connection configuration",
      );
    }
    return this.events.insertEvent(input);
  }
}

class AppPulledUsageEntitlement implements PulledUsageEntitlements {
  private constructor(private readonly host: GovernanceIngestionPullHost) {}

  static create(host: GovernanceIngestionPullHost): AppPulledUsageEntitlement {
    return new AppPulledUsageEntitlement(host);
  }

  isEnabled(organizationId: string): Promise<boolean> {
    return this.host.isPulledUsageCostEnabled(organizationId);
  }
}

class AppPulledUsageRate implements PulledUsageRateReader {
  private constructor(private readonly host: GovernanceIngestionPullHost) {}

  static create(host: GovernanceIngestionPullHost): AppPulledUsageRate {
    return new AppPulledUsageRate(host);
  }

  rate(input: PulledUsageRateInput) {
    return this.host.ratePulledUsage(input);
  }
}

class AppIngestionPullDiagnostics implements IngestionPullDiagnosticsSink {
  private constructor(private readonly host: GovernanceIngestionPullHost) {}

  static create(host: GovernanceIngestionPullHost): AppIngestionPullDiagnostics {
    return new AppIngestionPullDiagnostics(host);
  }

  private readonly logger = createLogger("langwatch:governance:pull-worker");

  info(message: string, context: Record<string, unknown>): void {
    this.logger.info(context, message);
  }

  warn(message: string, context: Record<string, unknown>): void {
    this.logger.warn(context, message);
  }

  error(message: string, context: Record<string, unknown>): void {
    this.logger.error(context, message);
  }

  capture(error: Error, context: Record<string, unknown>): void {
    this.host.capture(error, context);
  }
}

export class AppIngestionPullWorkerAdapter {
  private constructor(
    private readonly sources: IngestionPullSource,
    private readonly host: GovernanceIngestionPullHost,
    private readonly projects: GovernanceInternalProject,
    private readonly events: AppGovernanceOcsfEventsAdapter | undefined,
  ) {}

  static create(options: {
    sources: IngestionPullSource;
    host: GovernanceIngestionPullHost;
    projects: GovernanceInternalProject;
    events: AppGovernanceOcsfEventsAdapter | undefined;
  }): AppIngestionPullWorkerAdapter {
    return new AppIngestionPullWorkerAdapter(
      options.sources,
      options.host,
      options.projects,
      options.events,
    );
  }

  build(): IngestionPullWorkerService {
    return createIngestionPullWorker({
      sources: this.sources,
      projects: this.projects,
      http: AppGovernanceHttp.create(this.host),
      objects: AppGovernanceObjectStorage.create(this.host),
      sink: AppGovernanceOcsfEventSink.create(this.events),
      encryptor: AppGovernanceEncryption.create(this.host.encryption),
      usageEntitlement: AppPulledUsageEntitlement.create(this.host),
      usageRate: AppPulledUsageRate.create(this.host),
      diagnostics: AppIngestionPullDiagnostics.create(this.host),
    });
  }
}

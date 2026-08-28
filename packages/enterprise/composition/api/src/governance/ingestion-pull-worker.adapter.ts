// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { ProjectService } from "@langwatch/project-contract";
import {
  BuiltInPullerRegistryService,
  GovernanceHttpPort,
  GovernanceObjectStoragePort,
  GovernanceOcsfEventSinkPort,
  IngestionCredentialsService,
  IngestionPullDiagnosticsPort,
  type IngestionPullSourcePort,
  IngestionPullWorkerService,
  PulledUsageEntitlementPort,
  PulledUsagePricingService,
  PulledUsageRatePort,
  PulledUsageRecordService,
  type GovernanceOcsfEventInput,
  type GovernanceHttpResponse,
  type GovernanceObjectStorageCredentials,
  type PulledUsageRateInput,
} from "@langwatch/enterprise-governance-server";
import {
  AnthropicAdminPuller,
  ClaudeComplianceReferencePuller,
  CopilotStudioReferencePuller,
  CopilotStudioDataversePuller,
  DatabricksGeniePuller,
  HttpPollingPullerAdapter,
  OpenAiComplianceReferencePuller,
  OpenAiAdminPuller,
  PullerRegistryService,
  S3PollingPullerAdapter,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { AppGovernanceOcsfEventsAdapter } from "./governance-ocsf-events.clickhouse.repository";
import {
  AppGovernanceEncryptionPort,
  type GovernanceEncryption,
} from "./governance-infrastructure.adapter";

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

class AppGovernanceHttpPort extends GovernanceHttpPort {
  private constructor(private readonly host: GovernanceIngestionPullHost) {
    super();
  }

  static create(host: GovernanceIngestionPullHost): AppGovernanceHttpPort {
    return new AppGovernanceHttpPort(host);
  }

  async fetch(url: string, init: GovernanceHttpRequest) {
    return this.host.fetch(url, init);
  }
}

export class AppGovernanceObjectStoragePort extends GovernanceObjectStoragePort {
  private constructor(private readonly host: GovernanceIngestionPullHost) {
    super();
  }

  static create(host: GovernanceIngestionPullHost): AppGovernanceObjectStoragePort {
    return new AppGovernanceObjectStoragePort(host);
  }

  async list(input: GovernanceObjectStorageListInput): Promise<string[]> {
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
            return keys;
          }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken && pages < MAX_S3_PAGES);
      return keys;
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

class AppGovernanceOcsfEventSinkPort extends GovernanceOcsfEventSinkPort {
  private constructor(private readonly events: AppGovernanceOcsfEventsAdapter | undefined) {
    super();
  }

  static create(
    events: AppGovernanceOcsfEventsAdapter | undefined,
  ): AppGovernanceOcsfEventSinkPort {
    return new AppGovernanceOcsfEventSinkPort(events);
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

class AppPulledUsageEntitlementPort extends PulledUsageEntitlementPort {
  private constructor(private readonly host: GovernanceIngestionPullHost) {
    super();
  }

  static create(host: GovernanceIngestionPullHost): AppPulledUsageEntitlementPort {
    return new AppPulledUsageEntitlementPort(host);
  }

  isEnabled(organizationId: string): Promise<boolean> {
    return this.host.isPulledUsageCostEnabled(organizationId);
  }
}

class AppPulledUsageRatePort extends PulledUsageRatePort {
  private constructor(private readonly host: GovernanceIngestionPullHost) {
    super();
  }

  static create(host: GovernanceIngestionPullHost): AppPulledUsageRatePort {
    return new AppPulledUsageRatePort(host);
  }

  rate(input: PulledUsageRateInput) {
    return this.host.ratePulledUsage(input);
  }
}

class AppIngestionPullDiagnosticsPort extends IngestionPullDiagnosticsPort {
  private constructor(private readonly host: GovernanceIngestionPullHost) {
    super();
  }

  static create(host: GovernanceIngestionPullHost): AppIngestionPullDiagnosticsPort {
    return new AppIngestionPullDiagnosticsPort(host);
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
    private readonly sources: IngestionPullSourcePort,
    private readonly host: GovernanceIngestionPullHost,
    private readonly projects: ProjectService,
    private readonly events: AppGovernanceOcsfEventsAdapter | undefined,
  ) {}

  static create(options: {
    sources: IngestionPullSourcePort;
    host: GovernanceIngestionPullHost;
    projects: ProjectService;
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
    const diagnostics = AppIngestionPullDiagnosticsPort.create(this.host);
    const http = AppGovernanceHttpPort.create(this.host);
    const objects = AppGovernanceObjectStoragePort.create(this.host);
    const pullers = PullerRegistryService.create();
    pullers.register(HttpPollingPullerAdapter.create({ http, diagnostics }));
    pullers.register(S3PollingPullerAdapter.create({ objects, diagnostics }));
    pullers.register(CopilotStudioReferencePuller.create({ http, diagnostics }));
    pullers.register(CopilotStudioDataversePuller.create(http));
    pullers.register(OpenAiComplianceReferencePuller.create({ objects, diagnostics }));
    pullers.register(OpenAiAdminPuller.create(http));
    pullers.register(ClaudeComplianceReferencePuller.create({ http, diagnostics }));
    pullers.register(AnthropicAdminPuller.create(http));
    pullers.register(DatabricksGeniePuller.create(http));
    const registry = BuiltInPullerRegistryService.create(pullers).build();
    const credentials = IngestionCredentialsService.create(
      AppGovernanceEncryptionPort.create(this.host.encryption),
    );
    const pricing = PulledUsagePricingService.create(AppPulledUsageRatePort.create(this.host));
    return IngestionPullWorkerService.create({
      sources: this.sources,
      registry,
      credentials,
      projects: this.projects,
      sink: AppGovernanceOcsfEventSinkPort.create(this.events),
      usageEntitlement: AppPulledUsageEntitlementPort.create(this.host),
      usageRecords: PulledUsageRecordService.create(pricing),
      diagnostics,
    });
  }
}

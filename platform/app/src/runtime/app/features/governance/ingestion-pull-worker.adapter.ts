// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  governanceIngestionSourceSchema,
  type GovernanceIngestionSource,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  BuiltInPullerRegistryService,
  GovernanceHttpPort,
  GovernanceObjectStoragePort,
  GovernanceOcsfEventSinkPort,
  IngestionCredentialsService,
  IngestionPullDiagnosticsPort,
  IngestionPullSourcePort,
  IngestionPullWorkerService,
  PulledUsageEntitlementPort,
  PulledUsagePricingService,
  PulledUsageRatePort,
  PulledUsageRecordService,
  type GovernanceOcsfEventInput,
  type PulledUsageRateInput,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GovernanceOcsfEventsClickHouseRepository } from "~/runtime/app/features/governance/governance-ocsf-events.clickhouse.repository";
import { featureFlagService } from "~/server/featureFlag/featureFlag.service";
import { EMPTY_SPEND_USAGE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { rateSpendNanoUsd } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { AppGovernanceEncryptionPort } from "./governance-infrastructure.adapter";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

const MAX_S3_FILES = 100;
const MAX_S3_PAGES = 50;

class AppGovernanceHttpPort extends GovernanceHttpPort {
  async fetch(url: string, init: Parameters<GovernanceHttpPort["fetch"]>[1]) {
    return await ssrfSafeFetch(url, init);
  }
}

class AppGovernanceObjectStoragePort extends GovernanceObjectStoragePort {
  async list(
    input: Parameters<GovernanceObjectStoragePort["list"]>[0],
  ): Promise<string[]> {
    const client = this.client(input);
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
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken && pages < MAX_S3_PAGES);
    return keys;
  }

  async readText(
    input: Parameters<GovernanceObjectStoragePort["readText"]>[0],
  ): Promise<string> {
    const response = await this.client(input).send(
      new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      { abortSignal: input.signal },
    );
    if (!response.Body) {
      throw new Error(`empty body for s3://${input.bucket}/${input.key}`);
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
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
    return Buffer.concat(chunks).toString("utf8");
  }

  private client(input: {
    region: string;
    credentials: Parameters<GovernanceObjectStoragePort["list"]>[0]["credentials"];
  }): S3Client {
    const { accessKeyId, secretAccessKey, sessionToken } = input.credentials;
    return new S3Client({
      region: input.region,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey, sessionToken }
          : undefined,
    });
  }
}

class AppIngestionPullSourcePort extends IngestionPullSourcePort {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): AppIngestionPullSourcePort {
    return new AppIngestionPullSourcePort(database);
  }

  async tryFindById(id: string): Promise<GovernanceIngestionSource | null> {
    const source = await this.database.ingestionSource.findUnique({
      where: { id },
    });
    if (!source) return null;
    return governanceIngestionSourceSchema.parse({
      ...source,
      parserConfig:
        source.parserConfig &&
        typeof source.parserConfig === "object" &&
        !Array.isArray(source.parserConfig)
          ? source.parserConfig
          : {},
    });
  }
}

class AppGovernanceOcsfEventSinkPort extends GovernanceOcsfEventSinkPort {
  private constructor(
    private readonly events: GovernanceOcsfEventsClickHouseRepository | undefined,
  ) {
    super();
  }

  static create(
    events: GovernanceOcsfEventsClickHouseRepository | undefined,
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
  private constructor(
    private readonly enabled: (organizationId: string) => Promise<boolean>,
  ) {
    super();
  }

  static create(
    enabled: (organizationId: string) => Promise<boolean>,
  ): AppPulledUsageEntitlementPort {
    return new AppPulledUsageEntitlementPort(enabled);
  }

  isEnabled(organizationId: string): Promise<boolean> {
    return this.enabled(organizationId);
  }
}

class AppPulledUsageRatePort extends PulledUsageRatePort {
  rate(input: PulledUsageRateInput) {
    return rateSpendNanoUsd({
      model: input.model,
      usage: {
        ...EMPTY_SPEND_USAGE,
        input_tokens: input.quantities.tokensInput,
        output_tokens: input.quantities.tokensOutput,
        cache_read_input_tokens: input.quantities.tokensCacheRead,
        cache_creation_input_tokens: input.quantities.tokensCacheWrite,
      },
    });
  }
}

class AppIngestionPullDiagnosticsPort extends IngestionPullDiagnosticsPort {
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
    void withScope(async (scope) => {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra?.(key, value);
      }
      captureException(toError(error));
    });
  }
}

export class AppIngestionPullWorkerAdapter {
  private constructor(
    private readonly database: PrismaClient,
    private readonly projects: ProjectService,
    private readonly events: GovernanceOcsfEventsClickHouseRepository | undefined,
  ) {}

  static create(options: {
    database: PrismaClient;
    projects: ProjectService;
    events: GovernanceOcsfEventsClickHouseRepository | undefined;
  }): AppIngestionPullWorkerAdapter {
    return new AppIngestionPullWorkerAdapter(
      options.database,
      options.projects,
      options.events,
    );
  }

  build(): IngestionPullWorkerService {
    const diagnostics = new AppIngestionPullDiagnosticsPort();
    const registry = BuiltInPullerRegistryService.create({
      http: new AppGovernanceHttpPort(),
      objects: new AppGovernanceObjectStoragePort(),
      diagnostics,
    }).build();
    const credentials = IngestionCredentialsService.create(
      new AppGovernanceEncryptionPort(),
    );
    const pricing = PulledUsagePricingService.create(
      new AppPulledUsageRatePort(),
    );
    return IngestionPullWorkerService.create({
      sources: AppIngestionPullSourcePort.create(this.database),
      registry,
      credentials,
      projects: this.projects,
      sink: AppGovernanceOcsfEventSinkPort.create(this.events),
      usageEntitlement: AppPulledUsageEntitlementPort.create(
        (organizationId) =>
          featureFlagService.isEnabled("release_pulled_usage_cost_enabled", {
            distinctId: organizationId,
            organizationId,
          }),
      ),
      usageRecords: PulledUsageRecordService.create(pricing),
      diagnostics,
    });
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { MissingStaticAwsCredentialsError } from "@langwatch/aws-client";
import {
  type GovernancePuller,
  type PullResult,
  type PullRunOptions,
  SECURITY_LAKE_ADAPTER_ID,
  securityLakePullConfigSchema,
  type SecurityLakePullConfig,
} from "@langwatch/enterprise-governance-contract";
import { type InternalProjectQuery, PROJECT_KIND } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import type { GovernanceObjectStorageCredentials } from "../../../channels/object-store.channel.ts";
import { describeAwsFailure } from "../rules/aws-failure.rules.ts";
import {
  foldSecurityLakeRun,
  parseSecurityLakeHealth,
} from "../rules/security-lake-health.rules.ts";
import type { SecurityLakeReaderService } from "./security-lake-reader.service.ts";

export type InternalTenants = {
  ensureInternal(input: InternalProjectQuery): Promise<{ id: string }>;
};

/** An endpoint on an AWS domain (a regional, FIPS or VPC endpoint), where the subscriber role applies. */
export function isAwsHostedEndpoint(endpoint: string): boolean {
  return /(^|\.)amazonaws\.com(\.cn)?$/i.test(new URL(endpoint).hostname);
}

/** The sealed credentials key that holds the external id LangWatch generated for the source. */
export const SECURITY_LAKE_EXTERNAL_ID_KEY = "external_id";

export class MissingSecurityLakeExternalIdError extends Error {
  constructor() {
    super("The Security Lake source has no external id; add it again to get one");
    this.name = "MissingSecurityLakeExternalIdError";
  }
}

export function securityLakeCredentialsOf(
  credentials: Record<string, string> | undefined,
  config: Pick<SecurityLakePullConfig, "subscriberRoleArn" | "s3Endpoint" | "sqsEndpoint">,
): GovernanceObjectStorageCredentials {
  const accessKeyId = credentials?.aws_access_key_id?.trim();
  const secretAccessKey = credentials?.aws_secret_access_key?.trim();
  // Without the source's own pair the SDK would sign with the worker's identity.
  if (!accessKeyId || !secretAccessKey) throw new MissingStaticAwsCredentialsError();
  // An S3 or SQS store outside AWS (a local emulator) has no STS, so the keys sign directly there.
  const emulated = [config.s3Endpoint, config.sqsEndpoint].some(
    (endpoint) => endpoint !== undefined && !isAwsHostedEndpoint(endpoint),
  );
  const externalId = credentials?.[SECURITY_LAKE_EXTERNAL_ID_KEY]?.trim();
  if (!emulated && !externalId) throw new MissingSecurityLakeExternalIdError();
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: credentials?.aws_session_token?.trim() || undefined,
    requireStaticKeys: true,
    ...(emulated || !externalId
      ? {}
      : { assumeRole: { roleArn: config.subscriberRoleArn, externalId } }),
  };
}

/**
 * Security Lake as a scheduled pull: each run on the source's schedule reads its subscriber queue
 * once. Events go straight to governance_ocsf_events, so the run returns none, and the cursor holds
 * the source health folded from every run. Spec: specs/security-lake-ingest.feature
 */
export class SecurityLakePullerService implements GovernancePuller<SecurityLakePullConfig> {
  readonly id: string = SECURITY_LAKE_ADAPTER_ID;

  private constructor(
    private readonly deps: {
      reader: SecurityLakeReaderService;
      projects: InternalTenants;
      now: () => number;
    },
  ) {}

  static create(deps: {
    reader: SecurityLakeReaderService;
    projects: InternalTenants;
    now?: () => number;
  }): SecurityLakePullerService {
    return new SecurityLakePullerService({ ...deps, now: deps.now ?? Date.now });
  }

  validateConfig(config: unknown): SecurityLakePullConfig {
    return securityLakePullConfigSchema.parse(config);
  }

  async runOnce(options: PullRunOptions, config: SecurityLakePullConfig): Promise<PullResult> {
    if (!options.context) throw new Error("A Security Lake pull needs its source context");
    const tenant = await this.deps.projects.ensureInternal({
      organizationId: options.context.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    const run = await this.deps.reader
      .readOnce({
        tenantId: tenant.id,
        sourceId: options.context.ingestionSourceId,
        config,
        credentials: securityLakeCredentialsOf(options.credentials, config),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      .catch((error: unknown) => {
        throw new Error(describeAwsFailure(error));
      });
    const nowMs = this.deps.now();
    const health = foldSecurityLakeRun({
      previous: parseSecurityLakeHealth(options.cursor),
      run,
      nowMs,
    });
    return {
      events: [],
      writtenCount: run.written,
      cursor: JSON.stringify(health),
      errorCount: run.poison.length,
      completeness: run.messages >= config.maxMessagesPerRun ? "truncated" : "complete",
      readThroughAt: Temporal.Instant.fromEpochMilliseconds(nowMs).toString(),
    };
  }
}

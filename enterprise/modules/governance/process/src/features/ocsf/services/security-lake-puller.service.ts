// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type GovernancePuller,
  type PullResult,
  type PullRunOptions,
  SECURITY_LAKE_ADAPTER_ID,
  securityLakePullConfigSchema,
  type SecurityLakePullConfig,
} from "@langwatch/enterprise-governance-contract";
import { DispatchError, extractHttpStatus, isRetryableHttpStatus } from "@langwatch/eventing";
import { type InternalProjectQuery, PROJECT_KIND } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import { describeAwsFailure } from "../rules/aws-failure.rules.ts";
import {
  isMissingExternalIdError,
  isMissingKeyPairError,
  securityLakeCredentialsOf,
} from "../rules/security-lake-credentials.rules.ts";
import {
  foldSecurityLakeRun,
  parseSecurityLakeHealth,
} from "../rules/security-lake-health.rules.ts";
import type { SecurityLakeReaderService } from "./security-lake-reader.service.ts";

export type InternalTenants = {
  ensureInternal(input: InternalProjectQuery): Promise<{ id: string }>;
};

/** AWS throttling codes; some (SQS's RequestThrottled) come back as a 400, yet they pass. */
const AWS_THROTTLING_ERRORS: ReadonlySet<string> = new Set([
  "RequestThrottled",
  "Throttling",
  "ThrottlingException",
  "ThrottledException",
  "TooManyRequestsException",
  "RequestLimitExceeded",
  "SlowDown",
]);

/**
 * A failed run as the pull runner reads it: a 4xx from AWS or a missing key is the customer's to
 * fix, so it is refused rather than retried, throttling aside. The message keeps only the error
 * code, since AWS's own text can name our principals; the original error stays as the cause.
 */
function securityLakeRunFailure(error: unknown): DispatchError {
  const customerMessage = describeAwsFailure(error);
  const status = extractHttpStatus(error);
  const setupMissing = isMissingKeyPairError(error) || isMissingExternalIdError(error);
  const throttled = error instanceof Error && AWS_THROTTLING_ERRORS.has(error.name);
  const retryable =
    !setupMissing && (throttled || status === undefined || isRetryableHttpStatus(status));
  return new DispatchError({
    message: customerMessage,
    retryable,
    cause: error,
    ...(retryable ? {} : { customerMessage }),
  });
}

/**
 * Security Lake as a scheduled pull: each run on the source's schedule reads its subscriber queue
 * once. Events go straight to governance_ocsf_events, so the run returns none, and the cursor holds
 * the source health folded from every run.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
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
    const sourceId = options.context.ingestionSourceId;
    const run = await Promise.resolve()
      .then(() =>
        this.deps.reader.readOnce({
          tenantId: tenant.id,
          sourceId,
          config,
          credentials: securityLakeCredentialsOf(options.credentials, config),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      )
      .catch((error: unknown) => {
        throw securityLakeRunFailure(error);
      });
    const nowMs = this.deps.now();
    const health = foldSecurityLakeRun({
      previous: parseSecurityLakeHealth(options.cursor),
      run,
      nowMs,
    });
    // Messages left on the queue mean the source is not read through to now; the last stamp stays.
    const truncated = run.stoppedEarly || run.messages >= config.maxMessagesPerRun;
    return {
      events: [],
      writtenCount: run.written,
      cursor: JSON.stringify(health),
      errorCount: run.poison.length,
      completeness: truncated ? "truncated" : "complete",
      ...(truncated
        ? {}
        : { readThroughAt: Temporal.Instant.fromEpochMilliseconds(nowMs).toString() }),
    };
  }
}

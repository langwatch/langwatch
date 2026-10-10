// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PLATFORM_TENANT_ID } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  UsageReportRateLimitedError,
  type IncomingUsageReportRequest,
  type SaasServerConfig,
  type UsageReportReceipt,
} from "@langwatch/enterprise-saas-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import { countUnknownUsageFields, usageReportBodySchema } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

import type { SaasUsageReportPipeline } from "../eventing/saas-usage-report.pipeline.ts";
import type { SaasRateLimitRepository } from "../repositories/saas-rate-limit.repository.ts";
import {
  senderAddressesOf,
  USAGE_REPORT_GLOBAL_KEY,
  USAGE_REPORT_GLOBAL_LIMIT,
  USAGE_REPORT_PER_ADDRESS_LIMIT,
  USAGE_REPORT_PER_INSTANCE_LIMIT,
  usageReportAddressKey,
  usageReportInstanceKey,
} from "../rules/usage-report-limits.rules.ts";
import type { LangWatchCloudService } from "./langwatch-cloud.service.ts";

type UsageReportRecorder = Pick<LicensingApi, "recordUsageReport">;
type UsageReportFacts = Readonly<{
  recordUsageReportReceived: Pick<
    EventingCommands<SaasUsageReportPipeline>["recordUsageReportReceived"],
    "send"
  >;
}>;
type ReleaseConfig = Pick<
  SaasServerConfig,
  "latestRelease" | "latestReleaseCommit" | "releaseFloor"
>;

/**
 * The anonymous daily report a self-hosted install posts. It lands in the
 * install registry and as a `usage_report_received` fact nurturing sends to product
 * analytics; neither failing refuses it, since a refused report takes the install out of view. @see ../../../specs/usage-report-receiver.feature
 */
export class UsageReportReceiverService {
  readonly #cloud: LangWatchCloudService;
  readonly #rateLimits: SaasRateLimitRepository;
  readonly #registry: UsageReportRecorder;
  readonly #logger: Logger;
  readonly #receipt: UsageReportReceipt;
  #facts: UsageReportFacts | undefined;

  private constructor(parts: {
    cloud: LangWatchCloudService;
    rateLimits: SaasRateLimitRepository;
    registry: UsageReportRecorder;
    logger: Logger;
    release: ReleaseConfig;
  }) {
    this.#cloud = parts.cloud;
    this.#rateLimits = parts.rateLimits;
    this.#registry = parts.registry;
    this.#logger = parts.logger;
    this.#receipt = receiptOf(parts.release);
  }

  static create(parts: {
    cloud: LangWatchCloudService;
    rateLimits: SaasRateLimitRepository;
    registry: UsageReportRecorder;
    logger: Logger;
    release: ReleaseConfig;
  }): UsageReportReceiverService {
    return new UsageReportReceiverService(parts);
  }

  async receive({
    report,
    addressHeaders,
  }: IncomingUsageReportRequest): Promise<UsageReportReceipt> {
    this.#cloud.assertCloud();

    await this.#admit(USAGE_REPORT_GLOBAL_KEY, USAGE_REPORT_GLOBAL_LIMIT);
    for (const address of senderAddressesOf(addressHeaders)) {
      await this.#admit(usageReportAddressKey(address), USAGE_REPORT_PER_ADDRESS_LIMIT);
    }

    const unknownFields = countUnknownUsageFields(report);
    const { event, instance_id: instanceId, ...properties } = usageReportBodySchema.parse(report);

    await this.#admit(usageReportInstanceKey(instanceId), USAGE_REPORT_PER_INSTANCE_LIMIT);

    await this.#record({ instanceId, properties, unknownFields });
    await this.#recordFact({ instanceId, event, properties, unknownFields });

    return this.#receipt;
  }

  /** Binds the saas_usage_report pipeline's sender. */
  connect(facts: UsageReportFacts): void {
    this.#facts = facts;
  }

  async #recordFact(data: {
    instanceId: string;
    event: string;
    properties: Record<string, unknown>;
    unknownFields: number;
  }): Promise<void> {
    try {
      if (!this.#facts) throw new Error("saas_usage_report senders are not connected yet");
      await this.#facts.recordUsageReportReceived.send({
        ...data,
        tenantId: PLATFORM_TENANT_ID,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      this.#logger.error(
        { error, instanceId: data.instanceId },
        "a usage report was accepted but its fact was not recorded",
      );
    }
  }

  async #admit(key: string, limit: { requests: number; seconds: number }): Promise<void> {
    const decision = await this.#rateLimits.check(key, limit);
    if (!decision.allowed) throw new UsageReportRateLimitedError();
  }

  async #record(report: {
    instanceId: string;
    properties: Record<string, unknown>;
    unknownFields: number;
  }): Promise<void> {
    try {
      await this.#registry.recordUsageReport({
        ...report,
        receivedAt: nowInstant().toString({ fractionalSecondDigits: 3 }),
      });
    } catch (error) {
      this.#logger.error(
        { error, instanceId: report.instanceId },
        "a usage report was accepted but not recorded in the install registry",
      );
    }
  }
}

/** The latest release travels with its commit, so two builds of one release name are told apart. */
function receiptOf({
  latestRelease,
  latestReleaseCommit,
  releaseFloor,
}: ReleaseConfig): UsageReportReceipt {
  return {
    message: "Event captured",
    ...(latestRelease && {
      latest_release: { release: latestRelease, commit: latestReleaseCommit ?? null },
    }),
    ...(releaseFloor && { floor: releaseFloor }),
  };
}

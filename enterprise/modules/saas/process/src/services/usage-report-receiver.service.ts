// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  UsageReportRateLimitedError,
  type IncomingUsageReportRequest,
  type UsageReportReceipt,
} from "@langwatch/enterprise-saas-contract";
import type { Logger } from "@langwatch/observability";
import { countUnknownUsageFields, usageReportBodySchema } from "@langwatch/ops-contract";
import type { Clock, RateLimiter } from "@langwatch/process-stores/members";

import type { ProductAnalyticsChannel } from "../channels/product-analytics.channel.ts";
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

/**
 * The anonymous daily report a self-hosted install posts. It lands in the
 * install registry and in product analytics; neither failing refuses it, since
 * a refused report takes the install out of view. @see ../../../specs/usage-report-receiver.feature
 */
export class UsageReportReceiverService {
  readonly #cloud: LangWatchCloudService;
  readonly #rateLimiter: RateLimiter;
  readonly #registry: UsageReportRecorder;
  readonly #analytics: ProductAnalyticsChannel;
  readonly #clock: Clock;
  readonly #logger: Logger;

  private constructor(parts: {
    cloud: LangWatchCloudService;
    rateLimiter: RateLimiter;
    registry: UsageReportRecorder;
    analytics: ProductAnalyticsChannel;
    clock: Clock;
    logger: Logger;
  }) {
    this.#cloud = parts.cloud;
    this.#rateLimiter = parts.rateLimiter;
    this.#registry = parts.registry;
    this.#analytics = parts.analytics;
    this.#clock = parts.clock;
    this.#logger = parts.logger;
  }

  static create(parts: {
    cloud: LangWatchCloudService;
    rateLimiter: RateLimiter;
    registry: UsageReportRecorder;
    analytics: ProductAnalyticsChannel;
    clock: Clock;
    logger: Logger;
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
    this.#analytics.capture({
      distinctId: instanceId,
      event,
      properties: { ...properties, unknown_fields: unknownFields },
    });

    return { message: "Event captured" };
  }

  async #admit(key: string, limit: { requests: number; seconds: number }): Promise<void> {
    const decision = await this.#rateLimiter.check(key, limit);
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
        receivedAt: this.#clock.now().toString({ fractionalSecondDigits: 3 }),
      });
    } catch (error) {
      this.#logger.error(
        { error, instanceId: report.instanceId },
        "a usage report was accepted but not recorded in the install registry",
      );
    }
  }
}

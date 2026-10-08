// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  SaasApi,
  saasConfig,
  type SaasServerConfig,
  type IncomingUsageReportRequest,
  type SaasApi as SaasApiContract,
  type UsageReportReceipt,
} from "@langwatch/enterprise-saas-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";

import type { SaasChannels } from "../channels/saas.channels.ts";
import type { SaasRepositories } from "../repositories/saas.repositories.ts";
import { LangWatchCloudService } from "../services/langwatch-cloud.service.ts";
import { UsageReportReceiverService } from "../services/usage-report-receiver.service.ts";

type SaasSetup = FeatureSetup<
  typeof SaasModule.dependencies,
  SaasServerConfig,
  SaasRepositories,
  SaasChannels
>;

export class SaasModule implements SaasApiContract {
  static readonly contract = SaasApi;
  static readonly dependencies = {
    /** The registry of self-hosted installs an accepted report is recorded in. */
    licensing: LicensingApi,
  };
  /** `isSaas` is the shared leaf, so IS_SAAS keeps one owner and this module only reads it. */
  static readonly config = saasConfig;

  readonly #usageReports: UsageReportReceiverService;

  private constructor(usageReports: UsageReportReceiverService) {
    this.#usageReports = usageReports;
  }

  static create({
    config,
    dependencies,
    repositories,
    channels,
    resources,
  }: SaasSetup): SaasModule {
    const logger = createLogger("langwatch:saas");
    const { analytics } = channels;
    resources.own("LangWatch Cloud product-analytics client", () => analytics.close());

    return new SaasModule(
      UsageReportReceiverService.create({
        cloud: LangWatchCloudService.create({ isSaas: config.isSaas }),
        rateLimits: repositories.rateLimits,
        registry: dependencies.licensing,
        analytics,
        logger,
      }),
    );
  }

  receiveUsageReport(input: IncomingUsageReportRequest): Promise<UsageReportReceipt> {
    return this.#usageReports.receive(input);
  }
}

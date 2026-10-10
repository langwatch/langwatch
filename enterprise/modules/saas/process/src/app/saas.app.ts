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
import type { EventingCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";

import type { SaasUsageReportPipeline } from "../eventing/saas-usage-report.pipeline.ts";
import type { SaasRepositories } from "../repositories/saas.repositories.ts";
import { LangWatchCloudService } from "../services/langwatch-cloud.service.ts";
import { UsageReportReceiverService } from "../services/usage-report-receiver.service.ts";

type SaasSetup = FeatureSetup<typeof SaasModule.dependencies, SaasServerConfig, SaasRepositories>;

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

  static create({ config, dependencies, repositories }: SaasSetup): SaasModule {
    const logger = createLogger("langwatch:saas");

    return new SaasModule(
      UsageReportReceiverService.create({
        cloud: LangWatchCloudService.create({ isSaas: config.isSaas }),
        rateLimits: repositories.rateLimits,
        registry: dependencies.licensing,
        logger,
        release: config,
      }),
    );
  }

  /** Binds the saas_usage_report pipeline's own senders. */
  connectCommands(commands: EventingCommands<SaasUsageReportPipeline>): void {
    this.#usageReports.connect(commands);
  }

  receiveUsageReport(input: IncomingUsageReportRequest): Promise<UsageReportReceipt> {
    return this.#usageReports.receive(input);
  }
}

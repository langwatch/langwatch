// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  SaasApi,
  type IncomingUsageReportRequest,
  type SaasApi as SaasApiContract,
  type UsageReportReceipt,
} from "@langwatch/enterprise-saas-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OpsApi } from "@langwatch/ops-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";

import { productAnalyticsChannels } from "../channels/product-analytics-channels.registry.ts";
import { LangWatchCloudService } from "../services/langwatch-cloud.service.ts";
import { UsageReportReceiverService } from "../services/usage-report-receiver.service.ts";

const SAAS_CLOSED_READS = reads("logger", "clock", "rateLimiter");

/** The process members Cloud reads: three of the closed record, and the process's `isSaas` fact. */
export type SaasProcessMembers = MembersRead<typeof SAAS_CLOSED_READS> &
  Readonly<{ isSaas: boolean }>;

type SaasSetup = FeatureSetup<typeof SaasApp.dependencies, SaasProcessMembers, undefined>;

export class SaasApp implements SaasApiContract {
  static readonly contract = SaasApi;
  static readonly dependencies = {
    /** Where this deployment's product analytics goes. */
    ops: OpsApi,
    /** The registry of self-hosted installs an accepted report is recorded in. */
    licensing: LicensingApi,
  };
  /** `isSaas` is the process's own fact; IS_SAAS has one owner, and this module only reads it. */
  static readonly reads = [...SAAS_CLOSED_READS, "isSaas"] as const;

  readonly #usageReports: UsageReportReceiverService;

  private constructor(usageReports: UsageReportReceiverService) {
    this.#usageReports = usageReports;
  }

  static create({ dependencies, members, resources }: SaasSetup): SaasApp {
    const analytics = productAnalyticsChannels.live.create({
      targets: () => dependencies.ops.findProductAnalyticsTargets(),
      logger: members.logger,
    });
    resources.own("LangWatch Cloud product-analytics client", () => analytics.close());

    return new SaasApp(
      UsageReportReceiverService.create({
        cloud: LangWatchCloudService.create({ isSaas: members.isSaas }),
        rateLimiter: members.rateLimiter,
        registry: dependencies.licensing,
        analytics,
        clock: members.clock,
        logger: members.logger,
      }),
    );
  }

  receiveUsageReport(input: IncomingUsageReportRequest): Promise<UsageReportReceipt> {
    return this.#usageReports.receive(input);
  }
}

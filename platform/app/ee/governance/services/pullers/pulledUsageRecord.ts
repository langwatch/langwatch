// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PulledUsageRecordService } from "@langwatch/enterprise-governance-server";
import { AppPulledUsagePricingService } from "@ee/event-sourcing/pipelines/pulled-usage-processing/services/pulled-usage-pricing.service";

export class AppPulledUsageRecordService {
  private constructor(private readonly service: PulledUsageRecordService) {}

  static create(): AppPulledUsageRecordService {
    return new AppPulledUsageRecordService(
      PulledUsageRecordService.create(
        AppPulledUsagePricingService.create().pricing(),
      ),
    );
  }

  build(
    input: Parameters<PulledUsageRecordService["build"]>[0],
  ): ReturnType<PulledUsageRecordService["build"]> {
    return this.service.build(input);
  }
}

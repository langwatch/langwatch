// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";

import { fireOnboardingVariantAssigned } from "../rules/nurturing-guided-onboarding-service.rules.ts";
import type { NurturingCustomerIoSenderService } from "./nurturing-customer-io-sender.service.ts";
import type { NurturingGuidedOnboardingBackfillService } from "./nurturing-guided-onboarding-backfill.service.ts";

type GuidedOnboardingDeliveryDependencies = Readonly<{
  sender: NurturingCustomerIoSenderService;
  backfill?: NurturingGuidedOnboardingBackfillService;
}>;

/**
 * Guided onboarding's Customer.io signals: a variant assignment is sent as it happens, and a
 * login backfills the traits a person picked before the live hooks reached Customer.io.
 */
export class NurturingGuidedOnboardingDeliveryService {
  static create(
    dependencies: GuidedOnboardingDeliveryDependencies,
  ): NurturingGuidedOnboardingDeliveryService {
    return new NurturingGuidedOnboardingDeliveryService(dependencies);
  }

  private constructor(private readonly dependencies: GuidedOnboardingDeliveryDependencies) {}

  async deliver(signal: NurturingSignal): Promise<void> {
    if (signal.kind === "onboarding_variant_assigned") {
      this.dependencies.sender.send(fireOnboardingVariantAssigned(signal));
    }
    await this.dependencies.backfill?.deliver(signal);
  }
}

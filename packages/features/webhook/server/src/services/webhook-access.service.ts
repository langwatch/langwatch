import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { WebhookEndpointsNotEntitledError } from "@langwatch/webhook-contract";

export class WebhookAccessService {
  private constructor(
    private readonly entitlements: Pick<EntitlementApi, "getActivePlan">,
  ) {}

  static create(
    entitlements: Pick<EntitlementApi, "getActivePlan">,
  ): WebhookAccessService {
    return new WebhookAccessService(entitlements);
  }

  async assertEndpointsAvailable(organizationId: string): Promise<void> {
    const plan = await this.entitlements.getActivePlan({ organizationId });
    if (plan.webhookEndpointsEnabled !== true) {
      throw new WebhookEndpointsNotEntitledError();
    }
  }
}

import type { EntitlementService } from "@langwatch/entitlement-contract";
import { WebhookEndpointsNotEntitledError } from "@langwatch/enterprise-webhook-contract";

export class WebhookAccessService {
  private constructor(private readonly entitlements: EntitlementService) {}

  static create(entitlements: EntitlementService): WebhookAccessService {
    return new WebhookAccessService(entitlements);
  }

  async assertEndpointsAvailable(organizationId: string): Promise<void> {
    const plan = await this.entitlements.getActivePlan({ organizationId });
    if (plan.webhookEndpointsEnabled !== true) {
      throw new WebhookEndpointsNotEntitledError();
    }
  }
}

import type { WebhookEntitlementService } from "../services/webhook-entitlement.service";

export class WebhookEntitlementAdapter {
  private constructor(private readonly service: WebhookEntitlementService) {}

  static create(service: WebhookEntitlementService): WebhookEntitlementAdapter {
    return new WebhookEntitlementAdapter(service);
  }

  async assertEntitled(organizationId: string): Promise<void> {
    await this.service.assertEntitled(organizationId);
  }
}

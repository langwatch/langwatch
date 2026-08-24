import {
  WebhookEndpointsNotEntitledError,
  WebhookEntitlementService as WebhookEntitlementServiceContract,
} from "@langwatch/enterprise-webhooks-contract";
import type { WebhookPlanPort } from "../ports/webhook-plan.port";

export class WebhookEntitlementService extends WebhookEntitlementServiceContract {
  private constructor(private readonly plans: WebhookPlanPort) {
    super();
  }

  static create(plans: WebhookPlanPort): WebhookEntitlementService {
    return new WebhookEntitlementService(plans);
  }

  async assertEntitled(organizationId: string): Promise<void> {
    if (!(await this.plans.hasWebhookEndpoints(organizationId))) {
      throw new WebhookEndpointsNotEntitledError();
    }
  }
}

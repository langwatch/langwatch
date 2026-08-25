import {
  EntitlementService,
  type Plan,
} from "@langwatch/entitlement-contract";
import { WebhookEndpointsNotEntitledError } from "@langwatch/enterprise-webhook-contract";
import { describe, expect, it } from "vitest";
import { WebhookAccessService } from "../src/services/webhook-access.service";

const plan = (webhookEndpointsEnabled: boolean): Plan => ({
  planSource: "license",
  type: "enterprise",
  name: "Enterprise",
  free: false,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMessagesPerMonth: 10,
  canPublish: true,
  webhookEndpointsEnabled,
  prices: { USD: 0, EUR: 0 },
});

class FixedEntitlementService extends EntitlementService {
  constructor(private readonly activePlan: Plan) {
    super();
  }

  getActivePlan(): Promise<Plan> {
    return Promise.resolve(this.activePlan);
  }
}

describe("WebhookAccessService", () => {
  it("uses the shared EntitlementService plan", async () => {
    const access = WebhookAccessService.create(
      new FixedEntitlementService(plan(true)),
    );

    await expect(access.assertEndpointsAvailable("org-1")).resolves.toBeUndefined();
  });

  it("maps a disabled entitlement to the webhook handled error", async () => {
    const access = WebhookAccessService.create(
      new FixedEntitlementService(plan(false)),
    );

    await expect(access.assertEndpointsAvailable("org-1")).rejects.toBeInstanceOf(
      WebhookEndpointsNotEntitledError,
    );
  });
});

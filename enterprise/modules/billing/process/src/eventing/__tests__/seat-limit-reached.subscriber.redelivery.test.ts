// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * A redelivered seat-limit event meets billing's alert cooldown: ops sees one Slack alert.
 */
import type {
  BillingUsageLimitOrganization,
  ResourceLimitNotificationContext,
} from "@langwatch/enterprise-billing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { createTenantId } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { BillingAlertCooldownService } from "../../services/billing-alert-cooldown.service.ts";
import { NullBillingErrorReporter } from "../../services/billing-error-reporter.service.ts";
import type { NotificationService } from "../../services/billing-usage-notice.service.ts";
import type { SaaSPlanProviderService } from "../../services/plan-provider.service.ts";
import { ResourceLimitAlertService } from "../../services/resource-limit-alert.service.ts";
import { seatLimitReachedSubscriber } from "../seat-limit-reached.subscriber.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function subscriberWithAlerts() {
  const sent: ResourceLimitNotificationContext[] = [];
  const alerts = ResourceLimitAlertService.create({
    isSaas: true,
    cooldown: BillingAlertCooldownService.create({ ttlMs: DAY_MS }),
    organizations: createApiFixture<BillingUsageLimitOrganization>({
      findWithAdmins: async () => ({
        id: "org_acme",
        name: "Acme",
        sentPlanLimitAlert: null,
        members: [{ user: { id: "user_ana", name: "Ana", email: "ana@acme.com" } }],
      }),
    }),
    plans: createApiFixture<SaaSPlanProviderService>({
      getActivePlan: async () => createApiFixture<PlanInfo>({ name: "Launch" }),
    }),
    notices: createApiFixture<NotificationService>({
      sendSlackResourceLimitAlert: async (context) => void sent.push(context),
    }),
    errors: NullBillingErrorReporter.create(),
  });
  return { subscriber: seatLimitReachedSubscriber({ alerts }), sent };
}

describe("given an organization that reached its seat limit", () => {
  describe("when the same seat-limit-reached event is handled twice", () => {
    it("posts one ops Slack alert", async () => {
      const { subscriber, sent } = subscriberWithAlerts();
      const data = subscriber.data.parse({
        tenantId: "org_acme",
        organizationId: "org_acme",
        limitType: "members",
        current: 5,
        max: 5,
        occurredAt: Date.UTC(2026, 8, 28, 12),
      });
      const context = {
        tenantId: createTenantId("org_acme"),
        aggregateId: "org_acme",
        occurredAt: 1_000,
        eventId: "evt_1",
      };

      await subscriber.handle(data, context);
      await subscriber.handle(data, context);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ organizationId: "org_acme", current: 5, max: 5 });
    });
  });
});

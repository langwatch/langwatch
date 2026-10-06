// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * A redelivered limit-reached fact meets the organization's own stamp: ops is alerted once,
 * even when the redelivery lands on a process whose in-memory damper never saw the first.
 */
import type {
  BillingUsageLimitOrganization,
  PlanLimitNotificationContext,
} from "@langwatch/enterprise-billing-contract";
import { createTenantId } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { BillingAlertCooldownService } from "../../services/billing-alert-cooldown.service.ts";
import { NullBillingErrorReporter } from "../../services/billing-error-reporter.service.ts";
import type { NotificationService } from "../../services/billing-usage-notice.service.ts";
import { PlanLimitAlertService } from "../../services/plan-limit-alert.service.ts";
import { planLimitReachedSubscriber } from "../plan-limit-reached.subscriber.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Two worker processes over one organization row: each holds its own damper. */
function twoProcessesOverOneOrganization() {
  const sent: PlanLimitNotificationContext[] = [];
  let stamp: Instant | null = null;
  const organizations = createApiFixture<BillingUsageLimitOrganization>({
    findWithAdmins: async () => ({
      id: "org_acme",
      name: "Acme",
      sentPlanLimitAlert: stamp,
      members: [{ user: { id: "user_ana", name: "Ana", email: "ana@acme.com" } }],
    }),
    updateSentPlanLimitAlert: async (_organizationId, timestamp) => {
      stamp = timestamp;
    },
  });
  const notices = createApiFixture<NotificationService>({
    sendSlackPlanLimitAlert: async (context) => void sent.push(context),
    sendHubspotPlanLimitForm: async () => undefined,
  });
  const process = () =>
    planLimitReachedSubscriber({
      alerts: PlanLimitAlertService.create({
        isSaas: true,
        inFlight: new Set(),
        cooldown: BillingAlertCooldownService.create({ ttlMs: 30 * DAY_MS }),
        organizations,
        notices,
        errors: NullBillingErrorReporter.create(),
      }),
    });
  return { first: process(), second: process(), sent };
}

describe("given an organization whose allowance usage recorded as reached", () => {
  describe("when the same limit-reached event is delivered to two processes", () => {
    it("posts one ops Slack alert", async () => {
      const { first, second, sent } = twoProcessesOverOneOrganization();
      const data = first.data.parse({
        organizationId: "org_acme",
        month: "2026-09",
        occurredAt: Date.UTC(2026, 8, 28, 12),
        count: 12_000,
        allowance: 10_000,
        planName: "Free",
        unit: "events",
      });
      const context = {
        tenantId: createTenantId("org_acme"),
        aggregateId: "org_acme",
        occurredAt: 1_000,
        eventId: "evt_1",
      };

      await first.handle(data, context);
      await second.handle(data, context);

      expect(sent).toHaveLength(1);
    });
  });
});

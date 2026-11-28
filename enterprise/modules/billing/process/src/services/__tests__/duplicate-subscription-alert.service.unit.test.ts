/**
 * Ops hear once a day about an organization whose seat changes refuse for two live plans.
 * @see ../../../../../../specs/licensing/proration-preview.feature
 */
import type { BillingUsageLimitOrganization } from "@langwatch/enterprise-billing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { BillingAlertCooldownService } from "../billing-alert-cooldown.service.ts";
import { NullBillingErrorReporter } from "../billing-error-reporter.service.ts";
import type { NotificationService } from "../billing-usage-notice.service.ts";
import { DuplicateSubscriptionAlertService } from "../duplicate-subscription-alert.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const report = { organizationId: "org_acme", subscriptionIds: ["sub_a", "sub_b"] };

type Send = NotificationService["sendSlackDuplicateActiveSubscriptions"];

function alerts({ send = vi.fn<Send>(async () => true) } = {}) {
  const service = DuplicateSubscriptionAlertService.create({
    isSaas: true,
    cooldown: BillingAlertCooldownService.create({ ttlMs: DAY_MS }),
    organizations: createApiFixture<BillingUsageLimitOrganization>({
      findWithAdmins: async () => ({
        id: "org_acme",
        name: "ACME",
        sentPlanLimitAlert: null,
        members: [
          { user: { id: "user_morgan", name: "Morgan Ellis", email: "morgan@acme.example" } },
        ],
      }),
    }),
    plans: { getActivePlan: async () => createApiFixture<PlanInfo>({ name: "Growth" }) },
    notices: createApiFixture<NotificationService>({ sendSlackDuplicateActiveSubscriptions: send }),
    errors: NullBillingErrorReporter.create(),
  });
  return { service, send };
}

describe("given a seat change refused for two live subscriptions", () => {
  /** @scenario "Two active subscriptions refuse a seat change rather than picking one" */
  it("alerts with the organization, its admin, its plan and both subscription ids", async () => {
    const { service, send } = alerts();

    await service.reportDuplicateActive(report);

    expect(send).toHaveBeenCalledWith({
      organizationId: "org_acme",
      organizationName: "ACME",
      adminName: "Morgan Ellis",
      adminEmail: "morgan@acme.example",
      planName: "Growth",
      subscriptionIds: ["sub_a", "sub_b"],
    });
  });

  describe("when the customer retries again and again that day", () => {
    /** @scenario "Ops hear about the same organization's duplicate plans once a day" */
    it("alerts once", async () => {
      const { service, send } = alerts();

      await service.reportDuplicateActive(report);
      await service.reportDuplicateActive(report);
      await service.reportDuplicateActive(report);

      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the alert cannot be sent", () => {
    /** @scenario "Ops hear about the same organization's duplicate plans once a day" */
    it("never throws, and lets the next retry try again", async () => {
      const send = vi.fn<Send>(async () => {
        throw new Error("slack down");
      });
      const { service } = alerts({ send });

      await expect(service.reportDuplicateActive(report)).resolves.toBeUndefined();
      await service.reportDuplicateActive(report);

      expect(send).toHaveBeenCalledTimes(2);
    });

    it("lets the next retry try again when Slack refused the message", async () => {
      const send = vi.fn<Send>(async () => false);
      const { service } = alerts({ send });

      await service.reportDuplicateActive(report);
      await service.reportDuplicateActive(report);

      expect(send).toHaveBeenCalledTimes(2);
    });
  });
});

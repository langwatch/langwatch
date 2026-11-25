// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  BillingUsageLimitOrganization,
  PlanLimitNotificationContext,
  PlanLimitNotifierInput,
} from "@langwatch/enterprise-billing-contract";
/**
 * @vitest-environment node
 *
 * Main's `notifyPlanLimitReached`: Slack and HubSpot once per organization a month, on
 * LangWatch Cloud only, guarded in flight and by the organization's own stamp.
 * @see enterprise/modules/billing/specs/usage-limits.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingAlertCooldownService } from "../billing-alert-cooldown.service.ts";
import { BillingErrorReporter } from "../billing-error-reporter.service.ts";
import type { NotificationService } from "../billing-usage-notice.service.ts";
import { PlanLimitAlertService } from "../plan-limit-alert.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 28, 12, 0, 0);
const REACHED: PlanLimitNotifierInput = {
  organizationId: "org_acme",
  planName: "Free",
  usageUnit: "events",
  current: 12_000,
  max: 10_000,
};

class RecordingErrorReporter extends BillingErrorReporter {
  private constructor(readonly captured: Error[] = []) {
    super();
  }

  static create(): RecordingErrorReporter {
    return new RecordingErrorReporter();
  }

  capture(error: Error): void {
    this.captured.push(error);
  }
}

function alertsFor({
  isSaas = true,
  sentPlanLimitAlert = null,
}: {
  isSaas?: boolean;
  sentPlanLimitAlert?: Instant | null;
} = {}) {
  const slack: PlanLimitNotificationContext[] = [];
  const hubspot: PlanLimitNotificationContext[] = [];
  const stamped: Instant[] = [];
  const reads = { count: 0 };
  const alerts = PlanLimitAlertService.create({
    isSaas,
    inFlight: new Set(),
    cooldown: BillingAlertCooldownService.create({ ttlMs: 30 * DAY_MS }),
    organizations: createApiFixture<BillingUsageLimitOrganization>({
      findWithAdmins: async () => {
        reads.count += 1;
        return {
          id: "org_acme",
          name: "Acme",
          sentPlanLimitAlert,
          members: [{ user: { id: "user_ana", name: "Ana", email: "ana@acme.com" } }],
        };
      },
      updateSentPlanLimitAlert: async (_organizationId, timestamp) => void stamped.push(timestamp),
    }),
    notices: createApiFixture<NotificationService>({
      sendSlackPlanLimitAlert: async (context) => void slack.push(context),
      sendHubspotPlanLimitForm: async (context) => void hubspot.push(context),
    }),
    errors: RecordingErrorReporter.create(),
  });
  return { alerts, slack, hubspot, stamped, reads };
}

describe("the plan-limit alert", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given an organization that has just crossed its plan's allowance", () => {
    /** @scenario "Crossing the plan limit notifies the organization once" */
    it("sends Slack and HubSpot once with main's label and stamps the organization", async () => {
      const { alerts, slack, hubspot, stamped } = alertsFor();

      await alerts.notifyPlanLimitReached(REACHED);
      await alerts.notifyPlanLimitReached(REACHED);

      const context = {
        organizationId: "org_acme",
        organizationName: "Acme",
        adminName: "Ana",
        adminEmail: "ana@acme.com",
        planName: "Free",
        limitType: "Monthly Events",
        current: 12_000,
        max: 10_000,
      };
      expect(slack).toEqual([context]);
      expect(hubspot).toEqual([context]);
      expect(stamped.map((at) => at.epochMilliseconds)).toEqual([START]);
    });
  });

  describe("given an organization alerted about its plan limit today", () => {
    /** @scenario "A second crossing inside the cooldown does not notify again" */
    it("sends nothing, even on a process whose damper is empty", async () => {
      const { alerts, slack, hubspot } = alertsFor({
        sentPlanLimitAlert: Temporal.Instant.fromEpochMilliseconds(START - DAY_MS / 2),
      });

      await alerts.notifyPlanLimitReached(REACHED);

      expect(slack).toEqual([]);
      expect(hubspot).toEqual([]);
    });
  });

  describe("given two deliveries for the same organization at the same time", () => {
    /** @scenario "Two concurrent limit checks send one notification, not two" */
    it("sends one alert", async () => {
      const { alerts, slack } = alertsFor();

      await Promise.all([
        alerts.notifyPlanLimitReached(REACHED),
        alerts.notifyPlanLimitReached(REACHED),
      ]);

      expect(slack).toHaveLength(1);
    });
  });

  describe("given a self-hosted deployment", () => {
    it("sends nothing", async () => {
      const { alerts, slack, hubspot } = alertsFor({ isSaas: false });

      await alerts.notifyPlanLimitReached(REACHED);

      expect([...slack, ...hubspot]).toEqual([]);
    });
  });

  describe("given billing's stamp fact that organization has not applied yet", () => {
    /** @scenario "A plan-limit alert inside the apply window is not sent twice" */
    it("refuses the second alert at the damper, before the stale stamp is read", async () => {
      const { alerts, slack, stamped, reads } = alertsFor({ sentPlanLimitAlert: null });

      await alerts.notifyPlanLimitReached(REACHED);
      await alerts.notifyPlanLimitReached(REACHED);

      expect(slack).toHaveLength(1);
      expect(stamped).toHaveLength(1);
      expect(reads.count).toBe(1);
    });
  });
});

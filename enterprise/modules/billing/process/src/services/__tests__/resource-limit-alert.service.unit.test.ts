import type {
  BillingUsageLimitOrganization,
  ResourceLimitNotificationContext,
  ResourceLimitNotifierInput,
} from "@langwatch/enterprise-billing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
/**
 * @vitest-environment node
 *
 * Main's `notifyResourceLimitReached`: one ops Slack alert per organization
 * and limit a day, on LangWatch Cloud only, never thrown.
 * @see specs/licensing/resource-limit-notifications.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BillingAlertCooldownService } from "../billing-alert-cooldown.service.ts";
import { BillingErrorReporter } from "../billing-error-reporter.service.ts";
import type { NotificationService } from "../billing-usage-notice.service.ts";
import type { SaaSPlanProviderService } from "../plan-provider.service.ts";
import { ResourceLimitAlertService } from "../resource-limit-alert.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 28, 12, 0, 0);
const REACHED: ResourceLimitNotifierInput = {
  organizationId: "org_acme",
  limitType: "members",
  current: 5,
  max: 5,
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

const ACME = {
  id: "org_acme",
  name: "Acme",
  sentPlanLimitAlert: null,
  members: [{ user: { id: "user_ana", name: "Ana", email: "ana@acme.com" } }],
};

function alertsFor({
  isSaas = true,
  organizations = [ACME],
  send = async () => {},
}: {
  isSaas?: boolean;
  /** Answered in turn, the last one repeating. */
  organizations?: (typeof ACME | null)[];
  send?: (context: ResourceLimitNotificationContext) => Promise<void>;
} = {}) {
  const sent: ResourceLimitNotificationContext[] = [];
  const errors = RecordingErrorReporter.create();
  const alerts = ResourceLimitAlertService.create({
    isSaas,
    cooldown: BillingAlertCooldownService.create({ ttlMs: DAY_MS }),
    organizations: createApiFixture<BillingUsageLimitOrganization>({
      findWithAdmins: async () =>
        (organizations.length > 1 ? organizations.shift() : organizations[0]) ?? null,
    }),
    plans: createApiFixture<SaaSPlanProviderService>({
      getActivePlan: async () => createApiFixture<PlanInfo>({ name: "Launch" }),
    }),
    notices: createApiFixture<NotificationService>({
      sendSlackResourceLimitAlert: async (context) => {
        sent.push(context);
        await send(context);
      },
    }),
    errors,
  });
  return { alerts, sent, errors };
}

describe("the resource-limit alert", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "A reached seat limit sends the ops team a Slack alert" */
  it("sends main's alert with the organization, first admin, plan and limit label", async () => {
    const { alerts, sent } = alertsFor();

    await alerts.notifyResourceLimitReached(REACHED);

    expect(sent).toEqual([
      {
        organizationId: "org_acme",
        organizationName: "Acme",
        adminName: "Ana",
        adminEmail: "ana@acme.com",
        planName: "Launch",
        limitType: "Team Members",
        current: 5,
        max: 5,
      },
    ]);
  });

  /** @scenario "A repeat inside the cooldown sends nothing" */
  it("stays quiet for the same organization and limit inside a day", async () => {
    const { alerts, sent } = alertsFor();

    await alerts.notifyResourceLimitReached(REACHED);
    vi.setSystemTime(START + DAY_MS - 1);
    await alerts.notifyResourceLimitReached(REACHED);
    await alerts.notifyResourceLimitReached({ ...REACHED, limitType: "membersLite" });

    expect(sent.map(({ limitType }) => limitType)).toEqual(["Team Members", "Lite Members"]);
  });

  /** @scenario "Notification resumes after cooldown expires" */
  it("alerts again once the day has run", async () => {
    const { alerts, sent } = alertsFor();

    await alerts.notifyResourceLimitReached(REACHED);
    vi.setSystemTime(START + DAY_MS);
    await alerts.notifyResourceLimitReached(REACHED);

    expect(sent).toHaveLength(2);
  });

  /** @scenario "A failed alert is reported, never thrown, and lets the next one through" */
  it("reports a failed send, resolves, and releases the cooldown", async () => {
    const failure = new Error("slack unavailable");
    const { alerts, sent, errors } = alertsFor({
      send: () => Promise.reject(failure),
    });

    await expect(alerts.notifyResourceLimitReached(REACHED)).resolves.toBeUndefined();
    await alerts.notifyResourceLimitReached(REACHED);

    expect(errors.captured).toEqual([failure, failure]);
    expect(sent).toHaveLength(2);
  });

  it("sends nothing off LangWatch Cloud", async () => {
    const { alerts, sent } = alertsFor({ isSaas: false });

    await alerts.notifyResourceLimitReached(REACHED);

    expect(sent).toEqual([]);
  });

  it("releases the cooldown when the organization is not found", async () => {
    const { alerts, sent } = alertsFor({ organizations: [null, ACME] });

    await alerts.notifyResourceLimitReached(REACHED);
    expect(sent).toEqual([]);
    await alerts.notifyResourceLimitReached(REACHED);
    expect(sent).toHaveLength(1);
  });
});

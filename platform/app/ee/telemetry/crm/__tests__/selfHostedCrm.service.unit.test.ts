/**
 * Where a raised signal actually goes, and what happens when it cannot get
 * there.
 *
 * @see ../selfHostedCrm.service.ts
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SelfHostedInstanceRecord } from "../../instances/selfHostedInstances";
import { SelfHostedCrmService } from "../selfHostedCrm.service";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException,
  toError: (error: unknown) =>
    error instanceof Error ? error : new Error(String(error)),
}));

const INSTANCE: SelfHostedInstanceRecord = {
  id: "row-1",
  instanceId: "3f1c2b40-9a7e-4f2a-8f4c-6b1f0c2d9e77",
  firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
  lastSeenAt: new Date("2026-09-21T12:00:00.000Z"),
  version: "3.17.0",
  installMethod: "helm",
  chartVersion: "1.4.0",
  hostname: "langwatch.acme.test",
  environment: "production",
  installedAt: null,
  reportSchemaVersion: 2,
  organizationId: "org-acme",
  issuedLicenseId: "license-1",
  userEmailDomains: { "acme.test": 40 },
  latestReport: { users: 40, projects: 6, traces_28d: 250_000 },
  optionalMetricsReported: true,
  hostnameReported: true,
  reportCount: 30,
  lastUnknownFields: 0,
  raisedSignals: ["seats_crossed_threshold"],
};

function serviceOver({
  representative = { userId: "user-1", organizationName: "ACME" } as {
    userId: string;
    organizationName: string;
  } | null,
  nurturing = {
    groupUser: vi.fn(async () => undefined),
    trackEvent: vi.fn(async () => undefined),
  },
  sendSlackSelfHostedSignal = vi.fn(async () => undefined),
} = {}) {
  const service = new SelfHostedCrmService({
    customers: {
      findRepresentative: vi.fn(async () => representative),
      hasAccountOnDomain: vi.fn(async () => false),
    },
    notifications: { sendSlackSelfHostedSignal },
    nurturing,
    baseUrl: "https://app.langwatch.test",
  });
  return { service, nurturing, sendSlackSelfHostedSignal };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given an install raising a signal", () => {
  describe("when the signal is announced", () => {
    /** @scenario "A raised signal reaches Slack with the install behind it" */
    it("names the company, the release and the usage, and links to the install", async () => {
      const { service, sendSlackSelfHostedSignal } = serviceOver();

      await service.announce({
        signals: ["seats_crossed_threshold"],
        instance: INSTANCE,
        leadingDomain: "acme.test",
        organizationId: "org-acme",
      });

      expect(sendSlackSelfHostedSignal).toHaveBeenCalledTimes(1);
      expect(sendSlackSelfHostedSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          headline: "A self-hosted install grew past a team",
          organizationName: "ACME",
          leadingDomain: "acme.test",
          version: "3.17.0",
          users: 40,
          traces28d: 250_000,
          instanceUrl:
            "https://app.langwatch.test/ops/backoffice/self-hosted-instances",
        }),
      );
    });

    /** @scenario "An install bound to a customer gets its traits on that customer" */
    it("writes the install's traits on the customer and tracks one event per signal", async () => {
      const { service, nurturing } = serviceOver();

      await service.announce({
        signals: ["seats_crossed_threshold", "sustained_ingestion"],
        instance: INSTANCE,
        leadingDomain: "acme.test",
        organizationId: "org-acme",
      });

      expect(nurturing.groupUser).toHaveBeenCalledWith({
        userId: "user-1",
        groupId: "org-acme",
        traits: expect.objectContaining({
          self_hosted: true,
          self_hosted_version: "3.17.0",
          self_hosted_install_method: "helm",
          self_hosted_users: 40,
          self_hosted_traces_28d: 250_000,
        }),
      });
      expect(nurturing.trackEvent).toHaveBeenCalledTimes(2);
      expect(nurturing.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "self_hosted_seats_crossed_threshold",
        }),
      );
    });
  });
});

describe("given an install bound to no customer", () => {
  describe("when a signal is announced", () => {
    /** @scenario "An install with no license reaches Slack and no CRM record" */
    it("still posts to Slack and writes no traits", async () => {
      const { service, nurturing, sendSlackSelfHostedSignal } = serviceOver({
        representative: null,
      });

      await service.announce({
        signals: ["licensed_feature_without_license"],
        instance: { ...INSTANCE, organizationId: null, issuedLicenseId: null },
        leadingDomain: "acme.test",
        organizationId: null,
      });

      expect(sendSlackSelfHostedSignal).toHaveBeenCalledTimes(1);
      expect(sendSlackSelfHostedSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationName: null,
          leadingDomain: "acme.test",
        }),
      );
      expect(nurturing.groupUser).not.toHaveBeenCalled();
      expect(nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });
});

describe("given a CRM that refuses the call", () => {
  describe("when a signal is announced", () => {
    /** @scenario "The CRM failing never fails the report" */
    it("reports the failure and still reaches Slack", async () => {
      const { service, sendSlackSelfHostedSignal } = serviceOver({
        nurturing: {
          groupUser: vi.fn(async () => {
            throw new Error("customer.io is down");
          }),
          trackEvent: vi.fn(async () => undefined),
        },
      });

      await expect(
        service.announce({
          signals: ["seats_crossed_threshold"],
          instance: INSTANCE,
          leadingDomain: "acme.test",
          organizationId: "org-acme",
        }),
      ).resolves.toBeUndefined();

      expect(captureException).toHaveBeenCalled();
      expect(sendSlackSelfHostedSignal).toHaveBeenCalledTimes(1);
    });
  });
});

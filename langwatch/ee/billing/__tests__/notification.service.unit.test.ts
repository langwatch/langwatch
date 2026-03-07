import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSlackSend = vi.fn().mockResolvedValue(undefined);

// Mock external dependencies
vi.mock("@slack/webhook", () => ({
  IncomingWebhook: class MockIncomingWebhook {
    constructor() {
      // no-op
    }
    send = mockSlackSend;
  },
}));

vi.mock("../../../src/env.mjs", () => ({
  env: {
    BASE_HOST: "https://app.langwatch.ai",
  },
}));

vi.mock("../../../src/server/mailer/usageLimitEmail", () => ({
  sendUsageLimitEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/utils/logger/server", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

import { sendUsageLimitEmail } from "../../../src/server/mailer/usageLimitEmail";
import { captureException } from "../../../src/utils/posthogErrorCapture";
import { NotificationService } from "../notifications/notification.service";

const mockSendUsageLimitEmail = sendUsageLimitEmail as ReturnType<
  typeof vi.fn
>;

describe("NotificationService", () => {
  let service: NotificationService;
  let config: {
    baseHost: string;
    slackPlanLimitChannel?: string;
    slackSignupsChannel?: string;
    slackSubscriptionsChannel?: string;
    hubspotPortalId?: string;
    hubspotReachedLimitFormId?: string;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      baseHost: "https://app.langwatch.ai",
    };
    service = NotificationService.create({ config });
  });

  describe("create()", () => {
    it("returns a NotificationService instance", () => {
      expect(service).toBeInstanceOf(NotificationService);
    });
  });

  describe("sendUsageLimitEmail()", () => {
    const emailParams = {
      to: "admin@acme.com",
      orgName: "Acme",
      usageData: {
        organizationName: "Acme",
        usagePercentage: 90,
        usagePercentageFormatted: "90",
        currentMonthMessagesCount: 9000,
        maxMonthlyUsageLimit: 10000,
        crossedThreshold: 90,
        projectUsageData: [{ id: "p1", name: "Project A", messageCount: 9000 }],
        actionUrl: "https://app.langwatch.ai/settings/usage",
        logoUrl: "https://example.com/logo.png",
        severity: "High",
      },
    };

    describe("when email sends successfully", () => {
      it("delegates to sendUsageLimitEmail mailer", async () => {
        await service.sendUsageLimitEmail(emailParams);

        expect(mockSendUsageLimitEmail).toHaveBeenCalledWith({
          to: "admin@acme.com",
          organizationName: "Acme",
          usagePercentage: 90,
          usagePercentageFormatted: "90",
          currentMonthMessagesCount: 9000,
          maxMonthlyUsageLimit: 10000,
          crossedThreshold: 90,
          projectUsageData: [
            { id: "p1", name: "Project A", messageCount: 9000 },
          ],
          actionUrl: "https://app.langwatch.ai/settings/usage",
          logoUrl: "https://example.com/logo.png",
          severity: "High",
        });
      });
    });

    describe("when email fails", () => {
      it("rethrows the error", async () => {
        mockSendUsageLimitEmail.mockRejectedValueOnce(
          new Error("SMTP failure"),
        );

        await expect(
          service.sendUsageLimitEmail(emailParams),
        ).rejects.toThrow("SMTP failure");
      });
    });
  });

  describe("sendSlackPlanLimitAlert()", () => {
    const context = {
      organizationId: "org_1",
      organizationName: "Acme",
      adminName: "Jane",
      adminEmail: "jane@acme.com",
      planName: "free",
    };

    describe("when SLACK_PLAN_LIMIT_CHANNEL is not set", () => {
      it("returns without sending", async () => {
        config.slackPlanLimitChannel = undefined;

        await service.sendSlackPlanLimitAlert(context);

        expect(mockSlackSend).not.toHaveBeenCalled();
      });
    });

    describe("when SLACK_PLAN_LIMIT_CHANNEL is set", () => {
      it("sends a Slack message with plan limit info", async () => {
        config.slackPlanLimitChannel = "https://hooks.slack.com/test";

        await service.sendSlackPlanLimitAlert(context);

        expect(mockSlackSend).toHaveBeenCalledWith({
          text: expect.stringContaining("Plan limit reached: Acme"),
        });
      });
    });

    describe("when Slack webhook fails", () => {
      it("catches the error and captures exception", async () => {
        config.slackPlanLimitChannel = "https://hooks.slack.com/test";

        const error = new Error("webhook error");
        mockSlackSend.mockRejectedValueOnce(error);

        await service.sendSlackPlanLimitAlert(context);

        expect(captureException).toHaveBeenCalledWith(error);
      });
    });
  });

  describe("sendSlackResourceLimitAlert()", () => {
    const context = {
      organizationId: "org_1",
      organizationName: "Acme",
      adminName: "Jane",
      adminEmail: "jane@acme.com",
      planName: "Launch",
      limitType: "Workflows",
      current: 5,
      max: 5,
    };

    describe("when SLACK_PLAN_LIMIT_CHANNEL is set", () => {
      it("sends with correct text including resource type and counts", async () => {
        config.slackPlanLimitChannel = "https://hooks.slack.com/test";

        await service.sendSlackResourceLimitAlert(context);

        expect(mockSlackSend).toHaveBeenCalledWith({
          text: "Resource limit reached: Acme, jane@acme.com, Plan: Launch, Workflows: 5/5",
        });
      });
    });

    describe("when SLACK_PLAN_LIMIT_CHANNEL is not set", () => {
      it("returns without sending", async () => {
        config.slackPlanLimitChannel = undefined;

        await service.sendSlackResourceLimitAlert(context);

        expect(mockSlackSend).not.toHaveBeenCalled();
      });
    });

    describe("when Slack webhook fails", () => {
      it("catches the error and captures exception", async () => {
        config.slackPlanLimitChannel = "https://hooks.slack.com/test";

        const error = new Error("webhook error");
        mockSlackSend.mockRejectedValueOnce(error);

        await service.sendSlackResourceLimitAlert(context);

        expect(captureException).toHaveBeenCalledWith(error);
      });
    });
  });

  describe("sendSlackSubscriptionEvent()", () => {
    describe("when SLACK_CHANNEL_SUBSCRIPTIONS is not set", () => {
      it("returns without sending", async () => {
        config.slackSubscriptionsChannel = undefined;

        await service.sendSlackSubscriptionEvent({
          type: "confirmed",
          organizationId: "org_1",
          organizationName: "Acme",
          plan: "LAUNCH",
          subscriptionId: "sub_1",
        });

        expect(mockSlackSend).not.toHaveBeenCalled();
      });
    });

    describe("when sending a confirmed subscription event", () => {
      it("sends Slack blocks for confirmed subscription", async () => {
        config.slackSubscriptionsChannel = "https://hooks.slack.com/subs";

        await service.sendSlackSubscriptionEvent({
          type: "confirmed",
          organizationId: "org_1",
          organizationName: "Acme",
          plan: "LAUNCH",
          subscriptionId: "sub_1",
          startDate: new Date("2025-01-01"),
          maxMembers: 5,
          maxMessagesPerMonth: 10000,
        });

        expect(mockSlackSend).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: "header",
              text: expect.objectContaining({
                text: "Subscription activated",
              }),
            }),
          ]),
        });
      });
    });

    describe("when sending a prospective subscription event", () => {
      it("sends Slack blocks for prospective interest", async () => {
        config.slackSubscriptionsChannel = "https://hooks.slack.com/subs";

        await service.sendSlackSubscriptionEvent({
          type: "prospective",
          organizationId: "org_1",
          organizationName: "Acme",
          plan: "ACCELERATE",
          customerName: "John",
        });

        expect(mockSlackSend).toHaveBeenCalledWith({
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: "header",
              text: expect.objectContaining({
                text: "Prospective subscription interest",
              }),
            }),
          ]),
        });
      });
    });
  });

  describe("sendSlackSignupEvent()", () => {
    const payload = {
      userName: "Jane Doe",
      userEmail: "jane@example.com",
      organizationName: "Acme Corp",
      phoneNumber: "+31 20 123 4567",
      utmCampaign: "launch-week",
    };

    describe("when SLACK_CHANNEL_SIGNUPS is not set", () => {
      it("returns without sending", async () => {
        config.slackSignupsChannel = undefined;

        await service.sendSlackSignupEvent(payload);

        expect(mockSlackSend).not.toHaveBeenCalled();
      });
    });

    describe("when optional fields are present", () => {
      it("includes phone number and campaign in the Slack text", async () => {
        config.slackSignupsChannel = "https://hooks.slack.com/signups";

        await service.sendSlackSignupEvent(payload);

        expect(mockSlackSend).toHaveBeenCalledWith({
          text: "🔔 New user registered: Jane Doe, jane@example.com. Organization: Acme Corp, +31 20 123 4567, Campaign: launch-week",
        });
      });
    });

    describe("when optional fields are missing", () => {
      it("sends the baseline signup notification text", async () => {
        config.slackSignupsChannel = "https://hooks.slack.com/signups";

        await service.sendSlackSignupEvent({
          userName: "Jane Doe",
          userEmail: "jane@example.com",
          organizationName: "Acme Corp",
        });

        expect(mockSlackSend).toHaveBeenCalledWith({
          text: "🔔 New user registered: Jane Doe, jane@example.com. Organization: Acme Corp",
        });
      });
    });

    describe("when Slack webhook fails", () => {
      it("captures the exception and does not throw", async () => {
        config.slackSignupsChannel = "https://hooks.slack.com/signups";

        const error = new Error("signup webhook error");
        mockSlackSend.mockRejectedValueOnce(error);

        await service.sendSlackSignupEvent(payload);

        expect(captureException).toHaveBeenCalledWith(error);
      });
    });
  });

  describe("sendSlackLicensePurchase()", () => {
    const payload = {
      buyerEmail: "buyer@acme.com",
      planType: "GROWTH",
      seats: 5,
      amountPaid: 14900,
      currency: "usd",
    };

    describe("when SLACK_CHANNEL_SUBSCRIPTIONS is not set", () => {
      it("returns without sending", async () => {
        config.slackSubscriptionsChannel = undefined;

        await service.sendSlackLicensePurchase(payload);

        expect(mockSlackSend).not.toHaveBeenCalled();
      });
    });

    describe("when SLACK_CHANNEL_SUBSCRIPTIONS is set", () => {
      it("sends a license purchase notification via IncomingWebhook", async () => {
        config.slackSubscriptionsChannel = "https://hooks.slack.com/subs";

        await service.sendSlackLicensePurchase(payload);

        expect(mockSlackSend).toHaveBeenCalledWith(
          expect.objectContaining({
            text: "New License Purchase",
            blocks: expect.arrayContaining([
              expect.objectContaining({
                type: "header",
                text: expect.objectContaining({
                  text: "New License Purchase",
                }),
              }),
            ]),
          }),
        );
      });
    });
  });

  describe("sendHubspotPlanLimitForm()", () => {
    const context = {
      organizationId: "org_1",
      organizationName: "Acme",
      adminName: "Jane",
      adminEmail: "jane@acme.com",
      planName: "free",
    };

    describe("when HubSpot env vars are not set", () => {
      it("returns without sending", async () => {
        config.hubspotPortalId = undefined;
        config.hubspotReachedLimitFormId = undefined;

        const mockFetch = vi.spyOn(global, "fetch");

        await service.sendHubspotPlanLimitForm(context);

        expect(mockFetch).not.toHaveBeenCalled();
        mockFetch.mockRestore();
      });
    });

    describe("when HubSpot env vars are set", () => {
      it("submits form data to HubSpot", async () => {
        config.hubspotPortalId = "12345";
        config.hubspotReachedLimitFormId = "form_abc";

        const mockFetch = vi
          .spyOn(global, "fetch")
          .mockResolvedValue(new Response("ok", { status: 200 }));

        await service.sendHubspotPlanLimitForm(context);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.hsforms.com/submissions/v3/integration/submit/12345/form_abc",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("jane@acme.com"),
          }),
        );

        mockFetch.mockRestore();
      });
    });

    describe("when HubSpot request fails", () => {
      it("catches the error and captures exception", async () => {
        config.hubspotPortalId = "12345";
        config.hubspotReachedLimitFormId = "form_abc";

        const mockFetch = vi
          .spyOn(global, "fetch")
          .mockResolvedValue(new Response("fail", { status: 500 }));

        await service.sendHubspotPlanLimitForm(context);

        expect(captureException).toHaveBeenCalled();

        mockFetch.mockRestore();
      });
    });
  });
});

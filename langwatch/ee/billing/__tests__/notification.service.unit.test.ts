import { beforeEach, describe, expect, it, vi } from "vitest";

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
        const mockFetch = vi.fn();
        const localService = NotificationService.create({
          config: { ...config, hubspotPortalId: undefined, hubspotReachedLimitFormId: undefined },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotPlanLimitForm(context);

        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("when HubSpot env vars are set", () => {
      it("submits form data to HubSpot", async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(new Response("ok", { status: 200 }));
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotReachedLimitFormId: "form_abc",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotPlanLimitForm(context);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.hsforms.com/submissions/v3/integration/submit/12345/form_abc",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("jane@acme.com"),
          }),
        );
      });
    });

    describe("when HubSpot request fails", () => {
      it("catches the error and captures exception", async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(new Response("fail", { status: 500 }));
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotReachedLimitFormId: "form_abc",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotPlanLimitForm(context);

        expect(captureException).toHaveBeenCalled();
      });
    });
  });

  describe("sendHubspotSignupForm()", () => {
    const payload = {
      userName: "Jane Doe",
      userEmail: "jane@example.com",
      organizationName: "Acme Corp",
      phoneNumber: "+31 20 123 4567",
      signUpData: {
        featureUsage: "Evaluations",
        yourRole: "Engineer",
        usage: "Production",
        solution: "LLM monitoring",
        companySize: "10",
        utmCampaign: "launch-week",
      },
    };

    describe("when hubspotFormId is not configured", () => {
      it("returns without sending", async () => {
        const mockFetch = vi.fn();
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotFormId: undefined,
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotSignupForm(payload);

        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("when hubspotPortalId is not configured", () => {
      it("returns without sending", async () => {
        const mockFetch = vi.fn();
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: undefined,
            hubspotFormId: "form_signup",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotSignupForm(payload);

        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("when both hubspotPortalId and hubspotFormId are configured", () => {
      it("submits form data to the correct HubSpot URL with correct fields", async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(new Response("ok", { status: 200 }));
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotFormId: "form_signup",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotSignupForm(payload);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.hsforms.com/submissions/v3/integration/submit/12345/form_signup",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: expect.any(AbortSignal),
          }),
        );

        const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
        expect(body.fields).toEqual(
          expect.arrayContaining([
            { objectTypeId: "0-1", name: "company", value: "Acme Corp" },
            { objectTypeId: "0-1", name: "firstname", value: "Jane" },
            { objectTypeId: "0-1", name: "lastname", value: "Doe" },
            { objectTypeId: "0-1", name: "email", value: "jane@example.com" },
            {
              objectTypeId: "0-1",
              name: "mobilephone",
              value: "+31 20 123 4567",
            },
            {
              objectTypeId: "0-1",
              name: "Features_usage_multiple",
              value: "Evaluations",
            },
            { objectTypeId: "0-1", name: "user_role", value: "Engineer" },
            { objectTypeId: "0-1", name: "product_usage", value: "Production" },
            {
              objectTypeId: "0-1",
              name: "product_solution",
              value: "LLM monitoring",
            },
            { objectTypeId: "0-1", name: "organization_size", value: "10" },
            {
              objectTypeId: "0-1",
              name: "utm_campaign",
              value: "launch-week",
            },
          ]),
        );
        expect(body.context).toEqual({
          pageUri: "app.langwatch.ai",
          pageName: "Sign Up",
        });
      });

      it("splits a multi-word userName into firstname and lastname", async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(new Response("ok", { status: 200 }));
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotFormId: "form_signup",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotSignupForm({
          ...payload,
          userName: "Mary Jane Watson",
        });

        const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
        const firstNameField = body.fields.find(
          (f: any) => f.name === "firstname",
        );
        const lastNameField = body.fields.find(
          (f: any) => f.name === "lastname",
        );
        expect(firstNameField.value).toBe("Mary");
        expect(lastNameField.value).toBe("Watson");
      });

      it("uses empty strings for missing signUpData fields", async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(new Response("ok", { status: 200 }));
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotFormId: "form_signup",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotSignupForm({
          userName: "Jane",
          userEmail: "jane@example.com",
          organizationName: "Acme",
        });

        const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
        const usageField = body.fields.find(
          (f: any) => f.name === "Features_usage_multiple",
        );
        expect(usageField.value).toBe("Other");
      });
    });

    describe("when HubSpot request fails", () => {
      it("catches the error and captures exception", async () => {
        const mockFetch = vi
          .fn()
          .mockRejectedValue(new Error("Network error"));
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotFormId: "form_signup",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotSignupForm(payload);

        expect(captureException).toHaveBeenCalled();
      });
    });

    describe("when HubSpot returns a non-OK status", () => {
      it("captures a descriptive error", async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(new Response("fail", { status: 500 }));
        const localService = NotificationService.create({
          config: {
            ...config,
            hubspotPortalId: "12345",
            hubspotFormId: "form_signup",
          },
          fetchFn: mockFetch,
        });

        await localService.sendHubspotSignupForm(payload);

        expect(captureException).toHaveBeenCalled();
      });
    });
  });
});

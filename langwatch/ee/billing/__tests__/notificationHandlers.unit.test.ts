import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBillingNotificationHandlers,
  notifyPlanLimit,
  notifyResourceLimit,
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
} from "../notifications/notificationHandlers";
import type { SubscriptionNotificationPayload } from "../types";

describe("notificationHandlers", () => {
  const subscriptionPayload: SubscriptionNotificationPayload = {
    type: "prospective",
    organizationId: "org_123",
    organizationName: "Acme",
    plan: "LAUNCH",
  };

  beforeEach(() => {
    clearBillingNotificationHandlers();
  });

  describe("when dispatching subscription notifications", () => {
    it("dispatches through registered handler", async () => {
      const sendSubscriptionNotification = vi.fn();

      setBillingNotificationHandlers({
        sendSubscriptionNotification,
      });

      await notifySubscriptionEvent(subscriptionPayload);

      expect(sendSubscriptionNotification).toHaveBeenCalledWith(
        subscriptionPayload,
      );
    });
  });

  describe("when dispatching plan-limit notifications", () => {
    it("dispatches through registered handlers with full context", async () => {
      const sendSlackNotification = vi.fn();
      const sendHubspotNotification = vi.fn();

      setBillingNotificationHandlers({
        sendSlackNotification,
        sendHubspotNotification,
      });

      const planLimitContext = {
        organizationId: "org_123",
        organizationName: "Acme",
        adminName: "Admin",
        adminEmail: "admin@acme.com",
        planName: "LAUNCH",
      };

      await notifyPlanLimit(planLimitContext);

      expect(sendSlackNotification).toHaveBeenCalledWith(planLimitContext);
      expect(sendHubspotNotification).toHaveBeenCalledWith(planLimitContext);
    });

    it("dispatches with minimal context", async () => {
      const sendSlackNotification = vi.fn();

      setBillingNotificationHandlers({
        sendSlackNotification,
      });

      const minimalContext = {
        organizationId: "org_123",
        organizationName: "Acme",
        planName: "LAUNCH",
      };

      await notifyPlanLimit(minimalContext);

      expect(sendSlackNotification).toHaveBeenCalledWith(minimalContext);
    });
  });

  describe("notifyResourceLimit()", () => {
    it("dispatches only to Slack, not HubSpot", async () => {
      const sendSlackNotification = vi.fn();
      const sendHubspotNotification = vi.fn();

      setBillingNotificationHandlers({
        sendSlackNotification,
        sendHubspotNotification,
      });

      const resourceLimitContext = {
        organizationId: "org_123",
        organizationName: "Acme",
        planName: "Launch",
        limitType: "Workflows",
        current: 10,
        max: 10,
      };

      await notifyResourceLimit(resourceLimitContext);

      expect(sendSlackNotification).toHaveBeenCalledWith(resourceLimitContext);
      expect(sendHubspotNotification).not.toHaveBeenCalled();
    });

    it("does nothing when no Slack handler is registered", async () => {
      const sendHubspotNotification = vi.fn();

      setBillingNotificationHandlers({
        sendHubspotNotification,
      });

      await expect(
        notifyResourceLimit({
          organizationId: "org_123",
          organizationName: "Acme",
          planName: "Launch",
          limitType: "Workflows",
          current: 10,
          max: 10,
        }),
      ).resolves.toBeUndefined();

      expect(sendHubspotNotification).not.toHaveBeenCalled();
    });
  });

  describe("when handler throws an error", () => {
    it("swallows notification handler errors", async () => {
      setBillingNotificationHandlers({
        sendSubscriptionNotification: () => {
          throw new Error("boom");
        },
      });

      await expect(
        notifySubscriptionEvent(subscriptionPayload),
      ).resolves.toBeUndefined();
    });
  });

  describe("when clearing handlers", () => {
    it("clears all handlers", async () => {
      const sendSubscriptionNotification = vi.fn();
      const sendSlackNotification = vi.fn();

      setBillingNotificationHandlers({
        sendSubscriptionNotification,
        sendSlackNotification,
      });

      clearBillingNotificationHandlers();

      await notifySubscriptionEvent(subscriptionPayload);
      await notifyPlanLimit({
        organizationId: "org_123",
        organizationName: "Acme",
        planName: "LAUNCH",
      });

      expect(sendSubscriptionNotification).not.toHaveBeenCalled();
      expect(sendSlackNotification).not.toHaveBeenCalled();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBillingNotificationHandlers,
  notifyLicensePurchase,
  notifyPlanLimit,
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
} from "../notifications/notificationHandlers";
import type {
  LicensePurchaseNotificationPayload,
  SubscriptionNotificationPayload,
} from "../types";

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

  describe("when dispatching license purchase notifications", () => {
    const licensePurchasePayload: LicensePurchaseNotificationPayload = {
      buyerEmail: "buyer@acme.com",
      planType: "GROWTH",
      seats: 5,
      amountPaid: 4900,
      currency: "USD",
    };

    it("dispatches through registered handler", async () => {
      const sendLicensePurchaseNotification = vi.fn();

      setBillingNotificationHandlers({
        sendLicensePurchaseNotification,
      });

      await notifyLicensePurchase(licensePurchasePayload);

      expect(sendLicensePurchaseNotification).toHaveBeenCalledWith(
        licensePurchasePayload,
      );
    });

    it("does nothing when no handler is registered", async () => {
      await expect(
        notifyLicensePurchase(licensePurchasePayload),
      ).resolves.toBeUndefined();
    });

    it("swallows handler errors", async () => {
      setBillingNotificationHandlers({
        sendLicensePurchaseNotification: () => {
          throw new Error("slack is down");
        },
      });

      await expect(
        notifyLicensePurchase(licensePurchasePayload),
      ).resolves.toBeUndefined();
    });
  });

  describe("when clearing handlers", () => {
    it("clears all handlers", async () => {
      const sendSubscriptionNotification = vi.fn();
      const sendSlackNotification = vi.fn();
      const sendLicensePurchaseNotification = vi.fn();

      setBillingNotificationHandlers({
        sendSubscriptionNotification,
        sendSlackNotification,
        sendLicensePurchaseNotification,
      });

      clearBillingNotificationHandlers();

      await notifySubscriptionEvent(subscriptionPayload);
      await notifyPlanLimit({
        organizationId: "org_123",
        organizationName: "Acme",
        planName: "LAUNCH",
      });
      await notifyLicensePurchase({
        buyerEmail: "buyer@acme.com",
        planType: "GROWTH",
        seats: 5,
        amountPaid: 4900,
        currency: "USD",
      });

      expect(sendSubscriptionNotification).not.toHaveBeenCalled();
      expect(sendSlackNotification).not.toHaveBeenCalled();
      expect(sendLicensePurchaseNotification).not.toHaveBeenCalled();
    });
  });
});

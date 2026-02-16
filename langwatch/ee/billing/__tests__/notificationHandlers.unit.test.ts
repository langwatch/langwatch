import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBillingNotificationHandlers,
  clearPlanLimitNotificationHandlers,
  notifyPlanLimit,
  notifySubscriptionEvent,
  setBillingNotificationHandlers,
  setPlanLimitNotificationHandlers,
} from "../notificationHandlers";
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

  it("dispatches subscription notifications through registered handler", async () => {
    const sendSubscriptionNotification = vi.fn();

    setBillingNotificationHandlers({
      sendSubscriptionNotification,
    });

    await notifySubscriptionEvent(subscriptionPayload);

    expect(sendSubscriptionNotification).toHaveBeenCalledWith(
      subscriptionPayload,
    );
  });

  it("dispatches plan-limit notifications through registered handlers", async () => {
    const sendSlackNotification = vi.fn();
    const sendHubspotNotification = vi.fn();

    setPlanLimitNotificationHandlers({
      sendSlackNotification,
      sendHubspotNotification,
    });

    await notifyPlanLimit({
      organizationId: "org_123",
      organizationName: "Acme",
      adminName: "Admin",
      adminEmail: "admin@acme.com",
      planName: "LAUNCH",
    });

    expect(sendSlackNotification).toHaveBeenCalledTimes(1);
    expect(sendHubspotNotification).toHaveBeenCalledTimes(1);
  });

  it("keeps compatibility for legacy plan-limit registration", async () => {
    const sendSlackNotification = vi.fn();

    setPlanLimitNotificationHandlers({
      sendSlackNotification,
    });

    await notifyPlanLimit({
      organizationId: "org_123",
      organizationName: "Acme",
      planName: "LAUNCH",
    });

    expect(sendSlackNotification).toHaveBeenCalledTimes(1);
  });

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

  it("clears all handlers when legacy clear function is called", async () => {
    const sendSubscriptionNotification = vi.fn();
    const sendSlackNotification = vi.fn();

    setBillingNotificationHandlers({
      sendSubscriptionNotification,
      sendSlackNotification,
    });

    clearPlanLimitNotificationHandlers();

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

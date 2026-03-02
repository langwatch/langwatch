import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSlackLicensePurchaseNotification } from "../notifications/slackLicenseNotification";
import type { LicensePurchaseNotificationPayload } from "../types";

const basePayload: LicensePurchaseNotificationPayload = {
  buyerEmail: "buyer@acme.com",
  planType: "GROWTH",
  seats: 5,
  amountPaid: 4900,
  currency: "USD",
};

const webhookUrl = "https://hooks.slack.com/services/T00/B00/xxx";

describe("sendSlackLicensePurchaseNotification", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when sending a notification", () => {
    it("posts to the webhook URL", async () => {
      await sendSlackLicensePurchaseNotification({
        payload: basePayload,
        webhookUrl,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("includes buyer email in the message", async () => {
      await sendSlackLicensePurchaseNotification({
        payload: basePayload,
        webhookUrl,
      });

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      const sectionFields = body.blocks[1].fields;
      const buyerField = sectionFields.find((f: { text: string }) =>
        f.text.includes("buyer@acme.com"),
      );
      expect(buyerField).toBeDefined();
    });

    it("includes plan type in the message", async () => {
      await sendSlackLicensePurchaseNotification({
        payload: basePayload,
        webhookUrl,
      });

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      const sectionFields = body.blocks[1].fields;
      const planField = sectionFields.find((f: { text: string }) =>
        f.text.includes("GROWTH"),
      );
      expect(planField).toBeDefined();
    });

    it("includes seat count in the message", async () => {
      await sendSlackLicensePurchaseNotification({
        payload: basePayload,
        webhookUrl,
      });

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      const sectionFields = body.blocks[1].fields;
      const seatsField = sectionFields.find((f: { text: string }) =>
        f.text.includes("5"),
      );
      expect(seatsField).toBeDefined();
    });

    it("includes formatted amount in the message", async () => {
      await sendSlackLicensePurchaseNotification({
        payload: basePayload,
        webhookUrl,
      });

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      const sectionFields = body.blocks[1].fields;
      const amountField = sectionFields.find((f: { text: string }) =>
        f.text.includes("$49.00"),
      );
      expect(amountField).toBeDefined();
    });
  });

  describe("when the webhook fails", () => {
    it("throws an error on non-OK response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        sendSlackLicensePurchaseNotification({
          payload: basePayload,
          webhookUrl,
        }),
      ).rejects.toThrow("Slack webhook failed with status 500");
    });
  });
});

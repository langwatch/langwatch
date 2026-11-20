import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { EnvHttpProxyAgent, fetch } = vi.hoisted(() => ({
  EnvHttpProxyAgent: vi.fn(),
  fetch: vi.fn(),
}));

// Only the two this client calls; egress, which it imports too, keeps the rest of undici.
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  EnvHttpProxyAgent,
  fetch,
}));

import type { CustomerIoTransactionalRequest } from "../../customer-io-transactional.channel.ts";
import type { EmailOutboundProxyConfig } from "../../email-delivery.channel.ts";
import {
  CUSTOMER_IO_REQUEST_TIMEOUT_MS,
  HttpCustomerIoTransactionalChannel,
} from "../http.customer-io-transactional.channel.ts";

/**
 * Spec: modules/notification/specs/customer-io-transactional.feature
 */
const API_KEY = "cio_app_test_key";

const request: CustomerIoTransactionalRequest = {
  transactionalMessageId: "trigger-digest",
  identifiers: { email: "ada@acme.test" },
  to: "ada@acme.test",
  from: "LangWatch <contact@langwatch.test>",
  subject: "Trigger - Errors above threshold",
  body: "<p>digest</p>",
  replyTo: "LangWatch Triggers <no-reply+tag@langwatch.test>",
  headers: {
    "List-Unsubscribe": "<https://app.langwatch.test/api/unsubscribe?token=t>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
};

const channel = (
  region: "us" | "eu" | undefined = undefined,
  outboundProxy: EmailOutboundProxyConfig = {},
) => HttpCustomerIoTransactionalChannel.create({ apiKey: API_KEY, region, outboundProxy });

const sentInit = () =>
  fetch.mock.calls[0]?.[1] as {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    dispatcher?: unknown;
  };

beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ delivery_id: "dlv_1", queued_at: 1 }),
  });
});

afterEach(() => vi.restoreAllMocks());

describe("given the client on the default region", () => {
  describe("when it sends one message", () => {
    /** @scenario "The HTTP client sends the documented request" */
    it("posts JSON to the EU endpoint with the key as bearer and our message as the body", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");

      const sent = await channel().send(request);

      expect(sent).toEqual({ deliveryId: "dlv_1" });
      expect(fetch.mock.calls[0]?.[0]).toBe("https://api-eu.customer.io/v1/send/email");
      expect(sentInit().method).toBe("POST");
      expect(sentInit().headers).toEqual({
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      });
      expect(JSON.parse(sentInit().body)).toEqual({
        transactional_message_id: "trigger-digest",
        identifiers: { email: "ada@acme.test" },
        to: "ada@acme.test",
        from: "LangWatch <contact@langwatch.test>",
        subject: "Trigger - Errors above threshold",
        body: "<p>digest</p>",
        reply_to: "LangWatch Triggers <no-reply+tag@langwatch.test>",
        headers: {
          "List-Unsubscribe": "<https://app.langwatch.test/api/unsubscribe?token=t>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        send_to_unsubscribed: true,
        tracked: false,
      });
      expect(timeout).toHaveBeenCalledWith(CUSTOMER_IO_REQUEST_TIMEOUT_MS);
      expect(CUSTOMER_IO_REQUEST_TIMEOUT_MS).toBe(10_000);
      expect(sentInit().signal).toBeInstanceOf(AbortSignal);
    });
  });
});

describe("given the client on the US region behind an outbound proxy", () => {
  describe("when it sends one message", () => {
    /** @scenario "The HTTP client sends the documented request" */
    it("posts to the US endpoint through one proxy dispatcher", async () => {
      EnvHttpProxyAgent.mockImplementation(function (this: { close: () => Promise<void> }) {
        this.close = async () => undefined;
      });
      const gateway = channel("us", { httpsProxy: "http://proxy.acme.test:8080" });

      await gateway.send(request);
      await gateway.send(request);

      expect(fetch.mock.calls[0]?.[0]).toBe("https://api.customer.io/v1/send/email");
      expect(EnvHttpProxyAgent).toHaveBeenCalledOnce();
      expect(sentInit()).toHaveProperty("dispatcher");
    });
  });
});

describe("given Customer.io does not accept a send", () => {
  /** @scenario "A failed payment-recovery send still reaches the person" */
  it("raises the status without reading a reply that can echo the recipient", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const json = vi.fn();
    fetch.mockResolvedValue({ ok: false, status: 429, body: { cancel }, json });

    const sending = channel().send(request);

    await expect(sending).rejects.toMatchObject({ reason: "status", status: 429 });
    const failure = await sending.catch((error: unknown) => error);
    expect(String(failure)).not.toContain("ada@acme.test");
    expect(String(failure)).not.toContain(API_KEY);
    expect(cancel).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
  });

  /** @scenario "A failed payment-recovery send still reaches the person" */
  it("names a timeout when the request is aborted after ten seconds", async () => {
    fetch.mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }));

    await expect(channel().send(request)).rejects.toMatchObject({ reason: "timeout" });
  });

  /** @scenario "A failed payment-recovery send still reaches the person" */
  it("names a network error when the request never completes", async () => {
    fetch.mockRejectedValue(new TypeError("fetch failed"));

    await expect(channel().send(request)).rejects.toMatchObject({ reason: "network" });
  });

  /** @scenario "A failed payment-recovery send still reaches the person" */
  it("names an unreadable reply when an accepted send returns no delivery id", async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

    await expect(channel().send(request)).rejects.toMatchObject({ reason: "unreadable-reply" });
  });
});

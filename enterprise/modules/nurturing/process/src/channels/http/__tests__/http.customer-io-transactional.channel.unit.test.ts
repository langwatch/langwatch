// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: modules/notification/specs/customer-io-transactional.feature */
import type { TransactionalEmail } from "@langwatch/enterprise-nurturing-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CUSTOMER_IO_TRANSACTIONAL_TIMEOUT_MS,
  HttpCustomerIoTransactionalChannel,
} from "../http.customer-io-transactional.channel.ts";

const API_KEY = "cio_app_test_key";

const email: TransactionalEmail = {
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

type Posted = { url: string; init: RequestInit };

/** A network that records each request and gives `answer`'s reply or failure. */
function network(answer: () => Promise<Response>) {
  const posted: Posted[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    posted.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { posted, fetchFn };
}

const accepted = () =>
  Promise.resolve(new Response(JSON.stringify({ delivery_id: "dlv_1", queued_at: 1 })));

afterEach(() => vi.restoreAllMocks());

describe("given the client on the default region", () => {
  describe("when it sends one message", () => {
    /** @scenario "The HTTP client sends the documented request" */
    it("posts JSON to the EU endpoint with the key as bearer and our message as the body", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const { posted, fetchFn } = network(accepted);
      const channel = HttpCustomerIoTransactionalChannel.create({
        apiKey: API_KEY,
        region: undefined,
        fetchFn,
      });

      await expect(channel.send(email)).resolves.toEqual({ deliveryId: "dlv_1" });

      expect(posted).toHaveLength(1);
      expect(posted[0]?.url).toBe("https://api-eu.customer.io/v1/send/email");
      expect(posted[0]?.init.method).toBe("POST");
      expect(posted[0]?.init.headers).toEqual({
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(posted[0]?.init.body))).toEqual({
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
      expect(timeout).toHaveBeenCalledWith(CUSTOMER_IO_TRANSACTIONAL_TIMEOUT_MS);
      expect(CUSTOMER_IO_TRANSACTIONAL_TIMEOUT_MS).toBe(10_000);
      expect(posted[0]?.init.signal).toBeInstanceOf(AbortSignal);
    });
  });
});

describe("given the client on the US region", () => {
  describe("when it sends one message", () => {
    /** @scenario "The HTTP client sends the documented request" */
    it("posts to the US endpoint", async () => {
      const { posted, fetchFn } = network(accepted);

      const channel = HttpCustomerIoTransactionalChannel.create({
        apiKey: API_KEY,
        region: "us",
        fetchFn,
      });

      await channel.send(email);

      expect(posted[0]?.url).toBe("https://api.customer.io/v1/send/email");
    });
  });
});

describe("given Customer.io does not accept a send", () => {
  const send = (answer: () => Promise<Response>) =>
    HttpCustomerIoTransactionalChannel.create({
      apiKey: API_KEY,
      region: undefined,
      fetchFn: network(answer).fetchFn,
    }).send(email);

  /** @scenario "A failed usage-limit send still reaches the person" */
  it("raises the status without reading a reply that can echo the recipient", async () => {
    const reply = new Response(JSON.stringify({ meta: { error: "ada@acme.test" } }), {
      status: 429,
    });
    const json = vi.spyOn(reply, "json");
    const text = vi.spyOn(reply, "text");
    const sending = send(() => Promise.resolve(reply));

    await expect(sending).rejects.toMatchObject({ reason: "status", status: 429 });
    const failure = await sending.catch((error: unknown) => error);
    expect(String(failure)).not.toContain("ada@acme.test");
    expect(String(failure)).not.toContain(API_KEY);
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  /** @scenario "A failed usage-limit send still reaches the person" */
  it("names a timeout when the request is aborted after ten seconds", async () => {
    const aborted = Object.assign(new Error("aborted"), { name: "TimeoutError" });

    await expect(send(() => Promise.reject(aborted))).rejects.toMatchObject({ reason: "timeout" });
  });

  /** @scenario "A failed usage-limit send still reaches the person" */
  it("names a network error when the request never completes", async () => {
    const failed = () => Promise.reject(new TypeError("fetch failed"));

    await expect(send(failed)).rejects.toMatchObject({ reason: "network" });
  });

  /** @scenario "A failed usage-limit send still reaches the person" */
  it("names an unreadable reply when an accepted send returns no delivery id", async () => {
    const empty = () => Promise.resolve(new Response("{}"));

    await expect(send(empty)).rejects.toMatchObject({ reason: "unreadable-reply" });
  });
});

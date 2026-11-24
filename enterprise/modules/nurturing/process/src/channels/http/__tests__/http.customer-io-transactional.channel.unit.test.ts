// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: modules/notification/specs/customer-io-transactional.feature */
import { createHash } from "node:crypto";

import type { TransactionalEmail } from "@langwatch/enterprise-nurturing-contract";
import type * as TestHarness from "@langwatch/test-harness";
import { Liquid } from "liquidjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  lines: [] as { level: number; msg?: string; [field: string]: unknown }[],
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const harness = await vi.importActual<typeof TestHarness>("@langwatch/test-harness");
  const { logger, lines } = harness.createTestLogger();
  captured.lines = lines;
  return { ...(await importOriginal<object>()), createLogger: () => logger };
});

import {
  CUSTOMER_IO_TRANSACTIONAL_TIMEOUT_MS,
  HttpCustomerIoTransactionalChannel,
} from "../http.customer-io-transactional.channel.ts";

const API_KEY = "cio_app_test_key";

const email: TransactionalEmail = {
  transactionalMessageId: "usage-limit",
  identifiers: { email: "ada@acme.test" },
  to: "ada@acme.test",
  from: "LangWatch <contact@langwatch.test>",
  subject: "You reached your plan's usage limit",
  body: "<p>Upgrade to keep tracing</p>",
  replyTo: "LangWatch Triggers <no-reply+tag@langwatch.test>",
};

type Posted = { url: string; init: RequestInit };

/** A network that records each request and gives `answer`'s reply or failure. */
function network(answer: () => Promise<Response>) {
  const posted: Posted[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    posted.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { posted, fetchFn };
}

/** The JSON body the client posts is always a string; anything else fails the test loudly. */
function stringBody(body: RequestInit["body"]): string {
  if (typeof body !== "string") throw new Error("expected a string request body");
  return body;
}

const accepted = () =>
  Promise.resolve(new Response(JSON.stringify({ delivery_id: "dlv_1", queued_at: 1 })));

beforeEach(() => {
  captured.lines.length = 0;
});

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
      expect(JSON.parse(stringBody(posted[0]?.init.body))).toEqual({
        transactional_message_id: "usage-limit",
        identifiers: { email: "ada@acme.test" },
        to: "ada@acme.test",
        from: "LangWatch <contact@langwatch.test>",
        subject: "You reached your plan's usage limit",
        body: "<p>Upgrade to keep tracing</p>",
        reply_to: "LangWatch Triggers <no-reply+tag@langwatch.test>",
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

describe("given the client with an App API base URL", () => {
  describe("when it sends one message", () => {
    /** @scenario "CUSTOMER_IO_APP_API_BASE_URL replaces the regional host" */
    it.each([undefined, "us"] as const)(
      "posts to the base URL, not the regional host (region %s)",
      async (region) => {
        const { posted, fetchFn } = network(accepted);
        const channel = HttpCustomerIoTransactionalChannel.create({
          apiKey: API_KEY,
          region,
          baseUrl: "http://127.0.0.1:4010",
          fetchFn,
        });

        await channel.send(email);

        expect(posted.map((request) => request.url)).toEqual([
          "http://127.0.0.1:4010/v1/send/email",
        ]);
      },
    );
  });
});

describe("given the client with no App API base URL", () => {
  describe("when it sends one message", () => {
    /** @scenario "CUSTOMER_IO_APP_API_BASE_URL replaces the regional host" */
    it("posts to the regional host", async () => {
      const { posted, fetchFn } = network(accepted);
      const channel = HttpCustomerIoTransactionalChannel.create({
        apiKey: API_KEY,
        region: undefined,
        baseUrl: undefined,
        fetchFn,
      });

      await channel.send(email);

      expect(posted.map((request) => request.url)).toEqual([
        "https://api-eu.customer.io/v1/send/email",
      ]);
    });
  });
});

describe("given a subject and body holding user text that reads as Liquid", () => {
  describe("when it is sent", () => {
    /** @scenario "Liquid openers in the subject and body are printed literally" */
    it("prints every Liquid opener as a string literal, so Customer.io evaluates none of it", async () => {
      const { posted, fetchFn } = network(accepted);
      const channel = HttpCustomerIoTransactionalChannel.create({
        apiKey: API_KEY,
        region: undefined,
        fetchFn,
      });

      await channel.send({
        ...email,
        subject: "Usage limit for {{ 7 | plus: 5 }}",
        body: "<p>{% if true %}Acme{% endif %} {{{</p>",
      });

      const sent = JSON.parse(stringBody(posted[0]?.init.body)) as {
        subject: string;
        body: string;
      };
      expect(sent.subject).toBe('Usage limit for {{ "{{" }} 7 | plus: 5 }}');
      expect(sent.body).toBe('<p>{{ "{%" }} if true %}Acme{{ "{%" }} endif %} {{ "{{" }}{</p>');
    });
  });
});

describe("given user text that is, or only looks like, Liquid", () => {
  describe("when it is sent and Customer.io renders the posted subject and body", () => {
    // Rendering with real Liquid proves the escaping is lossless, which the
    // exact-string test above cannot: it only pins one encoding.
    /** @scenario "Liquid openers in the subject and body are printed literally" */
    it.each([
      "Hello {{ x }} there",
      "{% if a %}b{% endif %}",
      "a lone {{ here",
      "plain text with no Liquid",
      "{{{{ triple and %} closer",
    ])("renders %j back to the original text", async (text) => {
      const { posted, fetchFn } = network(accepted);
      const channel = HttpCustomerIoTransactionalChannel.create({
        apiKey: API_KEY,
        region: undefined,
        fetchFn,
      });

      await channel.send({ ...email, subject: text, body: text });

      const sent = JSON.parse(stringBody(posted[0]?.init.body)) as {
        subject: string;
        body: string;
      };
      const liquid = new Liquid();
      const context = { x: "X", a: true };
      expect(await liquid.parseAndRender(sent.subject, context)).toBe(text);
      expect(await liquid.parseAndRender(sent.body, context)).toBe(text);
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
});

describe("given Customer.io accepts a send with a reply that holds no delivery id", () => {
  describe.each([
    ["an empty object", () => new Response("{}", { status: 202 })],
    ["a body that is not JSON", () => new Response("queued", { status: 202 })],
  ])("when the reply is %s", (_name, reply) => {
    /** @scenario "An accepted send with no readable delivery id still counts as taken" */
    it("reports it taken and logs the template, a recipient hash and the status, never the address or key", async () => {
      const channel = HttpCustomerIoTransactionalChannel.create({
        apiKey: API_KEY,
        region: undefined,
        fetchFn: network(() => Promise.resolve(reply())).fetchFn,
      });

      await expect(channel.send(email)).resolves.toEqual({});

      expect(captured.lines).toHaveLength(1);
      expect(captured.lines[0]).toMatchObject({
        template: "usage-limit",
        recipientHash: createHash("sha256").update("ada@acme.test").digest("hex").slice(0, 16),
        status: 202,
      });
      const logged = JSON.stringify(captured.lines);
      expect(logged).not.toContain("ada@acme.test");
      expect(logged).not.toContain(API_KEY);
    });
  });
});

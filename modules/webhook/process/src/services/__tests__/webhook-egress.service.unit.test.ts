import { DispatchError } from "@langwatch/eventing";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HttpWebhookSender } from "../../channels/webhook-destination.channel.ts";
import type {
  WebhookDispatchCapCount,
  WebhookDispatchCapRepository,
} from "../../repositories/webhook-dispatch-cap.repository.ts";
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from "../../rules/webhook-signature.rules.ts";
import { describeTransportFailure } from "../../rules/webhook-transport-failure.rules.ts";
import { WebhookDispatchCapService } from "../webhook-dispatch-cap.service.ts";
import { WebhookEgressService } from "../webhook-egress.service.ts";

/**
 * Spec: modules/webhook/specs/webhook-egress.feature
 * The envelope and the cap: transport stubbed to read exact bytes/headers;
 * address blocks and the fence are covered in url-policy and http-destination tests.
 */

const mockedSend = vi.fn<HttpWebhookSender["send"]>();

/** Answers whatever it is told, and remembers what it was asked. */
class ScriptedCaps implements WebhookDispatchCapRepository {
  readonly calls: { scopeId: string; windowSeconds: number; max: number }[] = [];

  constructor(private readonly answer: WebhookDispatchCapCount) {}

  async countAttempt(input: {
    scopeId: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchCapCount> {
    this.calls.push(input);
    return this.answer;
  }
}

const allowing = () =>
  new ScriptedCaps({ allowed: true, remaining: 10, resetAt: Date.now() + 3_600_000 });

function serviceWith(caps: ScriptedCaps, now?: () => number) {
  return WebhookEgressService.create({
    caps: WebhookDispatchCapService.create({ caps }),
    http: { send: mockedSend },
    ...(now === undefined ? {} : { now }),
  });
}

const base = {
  url: "https://example.com/hook",
  body: JSON.stringify({ hello: "world" }),
  triggerName: "My automation",
};

const sentRequest = () => mockedSend.mock.calls[0]![0];
const sentHeaders = () => sentRequest().headers as Record<string, string>;

function transportResolves(overrides?: { status?: number; retryAfterMs?: number }) {
  mockedSend.mockResolvedValue({
    status: overrides?.status ?? 200,
    body: "ok",
    responseHeaders: {},
    ...(overrides?.retryAfterMs === undefined ? {} : { retryAfterMs: overrides.retryAfterMs }),
  });
}

afterEach(() => vi.clearAllMocks());

describe("WebhookEgressService", () => {
  describe("given a dispatch carrying a stable identity", () => {
    /** @scenario "Every delivery carries the dispatch identity its channel publishes" */
    it("sends it in the automations channel's header and echoes it back", async () => {
      transportResolves();

      const result = await serviceWith(allowing()).send({
        ...base,
        projectId: "proj_1",
        eventId: "evt_stable",
      });

      expect(sentHeaders()["X-LangWatch-Event-Id"]).toBe("evt_stable");
      expect(result.eventId).toBe("evt_stable");
    });

    /** @scenario "Every delivery carries the dispatch identity its channel publishes" */
    it("lets the endpoints platform name its own header instead", async () => {
      transportResolves();

      await serviceWith(allowing()).send({
        ...base,
        projectId: "org_1",
        eventId: "batch_1",
        dispatchIdHeader: "X-LangWatch-Delivery-Id",
        attempt: 3,
      });

      expect(sentHeaders()["X-LangWatch-Delivery-Id"]).toBe("batch_1");
      expect(sentHeaders()["X-LangWatch-Event-Id"]).toBeUndefined();
      expect(sentHeaders()["X-LangWatch-Delivery-Attempt"]).toBe("3");
    });
  });

  describe("given a dispatch naming no identity", () => {
    /** @scenario "A dispatch with no identity is given one rather than sent without" */
    it("mints one and reports it back to the caller", async () => {
      transportResolves();

      const result = await serviceWith(allowing()).send({ ...base, testFire: true });

      expect(sentHeaders()["X-LangWatch-Event-Id"]).toBe(result.eventId);
      expect(result.eventId).toMatch(/^event_/);
      expect(sentHeaders()["X-LangWatch-Test-Fire"]).toBe("true");
    });
  });

  describe("given customer headers that name reserved or malformed keys", () => {
    /** @scenario "A reserved header a customer set is never sent" */
    it("drops them and leaves the LangWatch envelope intact", async () => {
      transportResolves();

      await serviceWith(allowing()).send({
        ...base,
        projectId: "proj_1",
        eventId: "evt_stable",
        headers: {
          Authorization: "Bearer customer-token",
          Host: "elsewhere.example.com",
          "Content-Type": "text/plain",
          "X-LangWatch-Event-Id": "forged",
          "bad header": "value",
          Kept: "__kept__",
          Blank: "   ",
        },
      });

      expect(sentHeaders()).toEqual({
        Authorization: "Bearer customer-token",
        "Content-Type": "application/json",
        "X-LangWatch-Event-Id": "evt_stable",
      });
    });
  });

  describe("given a dispatch with signing secrets", () => {
    /** @scenario "A rotation window signs with every valid secret, newest first" */
    it("signs the exact bytes sent, at the timestamp on the header", async () => {
      transportResolves();

      await serviceWith(allowing(), () => 1_700_000_000_000).send({
        ...base,
        projectId: "proj_1",
        eventId: "evt_stable",
        signingSecrets: ["whsec_new", "whsec_old"],
      });

      const header = sentHeaders()[WEBHOOK_SIGNATURE_HEADER]!;
      expect(header.startsWith("t=1700000000,v1=")).toBe(true);
      for (const secret of ["whsec_new", "whsec_old"]) {
        expect(
          verifyWebhookSignature({
            secret,
            body: sentRequest().body!,
            header,
            nowSeconds: 1_700_000_000,
          }),
          secret,
        ).toBe(true);
      }
      expect(
        verifyWebhookSignature({
          secret: "whsec_never_issued",
          body: sentRequest().body!,
          header,
          nowSeconds: 1_700_000_000,
        }),
      ).toBe(false);
    });
  });

  describe("given a dispatch with no signing secret", () => {
    /** @scenario "A dispatch with no secret carries no signature header at all" */
    it("sends the same headers an empty secret list sends", async () => {
      transportResolves();
      const service = serviceWith(allowing());

      await service.send({ ...base, projectId: "proj_1", eventId: "evt_stable" });
      const unsigned = { ...sentHeaders() };
      expect(unsigned[WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();

      mockedSend.mockClear();
      await service.send({
        ...base,
        projectId: "proj_1",
        eventId: "evt_stable",
        signingSecrets: [],
      });

      expect(sentHeaders()).toEqual(unsigned);
    });
  });

  describe("given a scope that has reached its hourly dispatch cap", () => {
    /** @scenario "The hourly dispatch cap backs a flood off rather than dropping it" */
    /** @scenario "A project cannot flood an endpoint" */
    it("backs off retryably with the time the window resets in, contacting nobody", async () => {
      transportResolves();
      const limiter = new ScriptedCaps({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 120_000,
      });

      const error = (await serviceWith(limiter)
        .send({ ...base, projectId: "proj_1" })
        .catch((err: unknown) => err)) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBeGreaterThan(0);
      expect(mockedSend).not.toHaveBeenCalled();
    });
  });

  describe("given a dispatch cap and a real fire", () => {
    /** @scenario "The cap counts one attempt per dispatch under the key the tenant is billed by" */
    it("asks the cap once, for that scope's hourly window", async () => {
      transportResolves();
      const limiter = allowing();

      await serviceWith(limiter).send({ ...base, projectId: "proj_1" });

      expect(limiter.calls).toEqual([{ scopeId: "proj_1", windowSeconds: 3600, max: 1000 }]);
    });

    /** @scenario "A test fire rides the author's own limit, not the tenant's cap" */
    it("does not consult the counter for a test fire", async () => {
      transportResolves();
      const limiter = allowing();

      await serviceWith(limiter).send({ ...base, projectId: "proj_1", testFire: true });

      expect(limiter.calls).toEqual([]);
    });
  });

  describe("given a destination the address policy refuses", () => {
    /** @scenario "A send refuses a fenced address before it opens a connection" */
    /** @scenario "Requests to private or internal addresses are blocked" */
    it.each([
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://169.254.169.254/hook",
      "https://[::1]/hook",
      "http://example.com/hook",
      "https://example.com:8443/hook",
      "https://user:pass@example.com/hook",
    ])("refuses %s permanently, without a transport call or a cap spend", async (url) => {
      transportResolves();
      const limiter = allowing();

      const error = (await serviceWith(limiter)
        .send({ ...base, url, projectId: "proj_1" })
        .catch((err: unknown) => err)) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(false);
      expect(mockedSend).not.toHaveBeenCalled();
      expect(limiter.calls).toEqual([]);
    });
  });
});

/**
 * `content-type` is reserved: a customer cannot set it, so it always describes
 * the body sent. The automations channel states it (JSON or plain text); the
 * webhook endpoints platform passes nothing and keeps JSON.
 */
describe("WebhookEgressService content type", () => {
  describe("when the caller states nothing", () => {
    it("sends the JSON type every delivery carried before the parameter existed", async () => {
      transportResolves();

      await serviceWith(allowing()).send(base);

      expect(sentHeaders()["Content-Type"]).toBe("application/json");
    });
  });

  describe("when a customer header tries to claim content-type", () => {
    it("strips it, so the header always describes the body actually sent", async () => {
      transportResolves();

      await serviceWith(allowing()).send({
        ...base,
        headers: { "content-type": "application/xml" },
      });

      expect(sentHeaders()["Content-Type"]).toBe("application/json");
      expect(sentHeaders()["content-type"]).toBeUndefined();
    });
  });

  describe("when the caller states a plain-text body", () => {
    it("announces it as text, so the receiver does not try to parse JSON", async () => {
      transportResolves();

      await serviceWith(allowing()).send({
        ...base,
        body: "plain words",
        contentType: "text/plain; charset=utf-8",
      });

      expect(sentHeaders()["Content-Type"]).toBe("text/plain; charset=utf-8");
    });

    it("signs the body it sends, unchanged by the type", async () => {
      transportResolves();
      const nowMs = Date.now();

      await serviceWith(allowing(), () => nowMs).send({
        ...base,
        body: "plain words",
        contentType: "text/plain; charset=utf-8",
        signingSecrets: ["whsec_automations"],
      });

      expect(
        verifyWebhookSignature({
          secret: "whsec_automations",
          body: "plain words",
          header: sentHeaders()[WEBHOOK_SIGNATURE_HEADER] ?? "",
          nowSeconds: Math.floor(nowMs / 1000),
        }),
      ).toBe(true);
    });
  });

  describe("when a customer header tries to override it", () => {
    it("drops the customer header and keeps the derived type", async () => {
      transportResolves();

      await serviceWith(allowing()).send({
        ...base,
        headers: { "Content-Type": "application/xml" },
        contentType: "text/plain; charset=utf-8",
      });

      expect(sentHeaders()["Content-Type"]).toBe("text/plain; charset=utf-8");
    });
  });
});

function transportFailure({ cause }: { cause: Error }): DispatchError {
  return new DispatchError({
    message: `Webhook for trigger "Timeout watcher": HTTP request failed — ${cause.message}`,
    retryable: true,
    cause,
  });
}

async function testFire(): Promise<DispatchError> {
  const error = await serviceWith(allowing())
    .send({
      url: "https://hooks.example.com/in",
      body: "{}",
      triggerName: "Timeout watcher",
      testFire: true,
    })
    .catch((err: unknown) => err);
  if (!(error instanceof DispatchError)) {
    throw new Error("expected the test fire to raise a DispatchError");
  }
  return error;
}

describe("WebhookEgressService transport failures", () => {
  describe("when the endpoint cannot be reached", () => {
    /** @scenario "A test that cannot reach the endpoint names the transport failure" */
    it.each([
      {
        cause: new Error("Could not resolve hostname: hooks.example.com"),
        named: /hostname could not be resolved/,
      },
      {
        cause: new Error("Connection refused - is the server running at 203.0.113.9:443?"),
        named: /refused the connection/,
      },
      {
        cause: new Error(
          "Connection failed to 203.0.113.9:443: The operation was aborted due to timeout",
        ),
        named: /did not answer in time/,
      },
      {
        cause: new Error("TLS certificate error for hooks.example.com: certificate has expired"),
        named: /TLS certificate could not be verified/,
      },
    ])("names the failure for $cause.message", async ({ cause, named }) => {
      mockedSend.mockRejectedValue(transportFailure({ cause }));

      const error = await testFire();

      expect(error.customerMessage).toMatch(named);
      expect(error.customerMessage).not.toMatch(/example\.com|203\.0\.113/);
      expect(error.retryable).toBe(true);
    });
  });

  describe("when the failure says nothing recognisable", () => {
    it("says the endpoint could not be reached", async () => {
      mockedSend.mockRejectedValue(transportFailure({ cause: new Error("kaboom") }));

      const error = await testFire();

      expect(error.customerMessage).toBe("The endpoint could not be reached.");
    });
  });

  describe("when the failure already carries customer copy", () => {
    it("keeps it rather than renaming the failure", async () => {
      mockedSend.mockRejectedValue(
        new DispatchError({ message: "internal", retryable: false, customerMessage: "Kept." }),
      );

      const error = await testFire();

      expect(error.customerMessage).toBe("Kept.");
    });
  });
});

describe("describeTransportFailure", () => {
  describe("given only the trigger name mentions a timeout", () => {
    it("reads the cause, not the label", () => {
      expect(describeTransportFailure({ error: new Error("ECONNRESET") })).toMatch(
        /closed the connection/,
      );
    });
  });

  describe("given an undici error whose code sits on its cause", () => {
    it("reads the code from the cause", () => {
      const error = new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
      });
      expect(describeTransportFailure({ error })).toMatch(/refused the connection/);
    });
  });
});

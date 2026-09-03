import { DispatchError } from "@langwatch/eventing";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../webhook/http-destination", () => ({ sendHttpDestination: vi.fn() }));

import { InMemoryWebhookDispatchRateLimiterAdapter } from "../../adapters/in-memory.webhook-dispatch-rate-limiter.adapter";
import {
  WebhookDispatchRateLimiterPort,
  type WebhookDispatchRateLimitResult,
} from "../../ports/webhook-dispatch-rate-limiter.port";
import { sendHttpDestination } from "../../webhook/http-destination";
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from "../../webhook/signature";
import { WebhookEgressService } from "../webhook-egress.service";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * The envelope and the cap. The transport is stubbed so the exact bytes and
 * headers of one dispatch can be read off; the executed address blocks live in
 * `webhook/__tests__/url-policy.unit.test.ts` and the executed fence in
 * `webhook/__tests__/http-destination.network.unit.test.ts`.
 */

const mockedSend = vi.mocked(sendHttpDestination);

/** Answers whatever it is told, and remembers what it was asked. */
class ScriptedRateLimiter extends WebhookDispatchRateLimiterPort {
  readonly calls: Array<{ key: string; windowSeconds: number; max: number }> = [];

  constructor(private readonly answer: WebhookDispatchRateLimitResult) {
    super();
  }

  async limit(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchRateLimitResult> {
    this.calls.push(input);
    return this.answer;
  }
}

const allowing = () =>
  new ScriptedRateLimiter({ allowed: true, remaining: 10, resetAt: Date.now() + 3_600_000 });

function serviceWith(rateLimiter: WebhookDispatchRateLimiterPort, now?: () => number) {
  return WebhookEgressService.create({
    rateLimiter,
    tls: { rejectUnauthorized: true },
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
      expect(result.eventId).toMatch(/[0-9a-f-]{36}/);
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
    it("backs off retryably with the time the window resets in, contacting nobody", async () => {
      transportResolves();
      const limiter = new ScriptedRateLimiter({
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
    it("asks the counter once, for that scope's hourly window", async () => {
      transportResolves();
      const limiter = allowing();

      await serviceWith(limiter).send({ ...base, projectId: "proj_1" });

      expect(limiter.calls).toEqual([
        { key: "webhook-dispatch:proj_1", windowSeconds: 3600, max: 1000 },
      ]);
    });

    /** @scenario "A test fire rides the author's own limit, not the tenant's cap" */
    it("does not consult the counter for a test fire", async () => {
      transportResolves();
      const limiter = allowing();

      await serviceWith(limiter).send({ ...base, projectId: "proj_1", testFire: true });

      expect(limiter.calls).toEqual([]);
    });
  });

  describe("given a process with no shared counter", () => {
    /** @scenario "A process with no shared counter still bounds the burst" */
    it("still refuses past the cap, per process rather than per fleet", async () => {
      transportResolves();
      const limiter = InMemoryWebhookDispatchRateLimiterAdapter.create();

      const results = await Promise.all(
        Array.from({ length: 1001 }, () =>
          limiter.limit({ key: "webhook-dispatch:proj_1", windowSeconds: 3600, max: 1000 }),
        ),
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(1000);
      expect(results.at(-1)?.allowed).toBe(false);
      expect(results.at(-1)?.resetAt).toBeGreaterThan(Date.now());
    });
  });

  describe("given a destination the address policy refuses", () => {
    /** @scenario "A send refuses a fenced address before it opens a connection" */
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

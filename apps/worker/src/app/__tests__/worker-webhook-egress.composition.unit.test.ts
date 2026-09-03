import { WebhookEgressService } from "@langwatch/egress";
import { DispatchError } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import { createWorkerWebhookTransport } from "../worker-webhook-egress.composition";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * This is a COMPOSITION-CAPABILITY test, not a mounted pipeline. The
 * application still owns webhook dispatch; what has to be true today is that
 * this process can build the fenced sender from configuration it already reads,
 * and that a dispatch driven THROUGH `WebhookDeliveryTransport` is fenced by the
 * same rules the application fences by.
 *
 * There is deliberately no successful-delivery case here, and its absence is the
 * point: the strict policy refuses plain http, refuses a non-default port and
 * refuses every loopback address, so no local test server is reachable through
 * this transport at all. The envelope on the wire is pinned in
 * `@langwatch/egress`'s own suite, against the fence's own seam.
 */

const ENVIRONMENT = {
  BASE_HOST: "https://app.langwatch.test",
  EMAIL_DEFAULT_FROM: "LangWatch <contact@langwatch.ai>",
};

/** The three Redis verbs the dispatch cap uses, and a record of the calls. */
function countingRedis(count: number) {
  const calls: string[] = [];
  const connection = {
    incr: async (key: string) => {
      calls.push(key);
      return count;
    },
    expire: async () => 1,
    ttl: async () => 900,
  };

  return { calls, connection: connection as unknown as RedisConnection };
}

const dispatch = {
  body: JSON.stringify({ hello: "world" }),
  triggerName: "Error rate",
  projectId: "project-1",
  eventId: "evt_1",
};

afterEach(() => vi.restoreAllMocks());

describe("createWorkerWebhookTransport", () => {
  describe("given a deployment that decided whether it verifies TLS certificates", () => {
    /**
     * The one leaf nothing else can observe. Certificate verification never
     * shows up in a refusal or a status — a process that stopped verifying
     * delivers perfectly, to whoever answered. So the composition is asserted
     * at the seam it hands the answer over at, and the answer is read from the
     * same variable the application reads it from rather than defaulted here.
     */
    /** @scenario "A process builds the webhook transport from its own configuration" */
    it.each([
      ["1", true],
      ["true", true],
      [undefined, false],
    ])("hands the fence the deployment's own IS_SAAS answer (%s)", (isSaas, expected) => {
      const created = vi.spyOn(WebhookEgressService, "create");

      createWorkerWebhookTransport({
        config: resolveWorkerConfig({
          ...ENVIRONMENT,
          ...(isSaas === undefined ? {} : { IS_SAAS: isSaas }),
        }),
      });

      expect(created).toHaveBeenCalledTimes(1);
      expect(created.mock.calls[0]![0].tls).toEqual({ rejectUnauthorized: expected });
    });
  });

  describe("given a deployment this process already read its configuration for", () => {
    /** @scenario "A process builds the webhook transport from its own configuration" */
    it("builds the transport without asking for configuration of its own", () => {
      const transport = createWorkerWebhookTransport({
        config: resolveWorkerConfig(ENVIRONMENT),
      });

      expect(transport).toBeDefined();
    });

    /** @scenario "A process builds the webhook transport from its own configuration" */
    it.each([
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/hook",
      "https://[::1]/hook",
      "http://example.com/hook",
      "https://example.com:8443/hook",
      "https://user:pass@example.com/hook",
    ])("refuses %s permanently, before any connection or cap spend", async (url) => {
      const redis = countingRedis(1);
      const transport = createWorkerWebhookTransport({
        config: resolveWorkerConfig(ENVIRONMENT),
        redis: redis.connection,
      });

      const error = (await transport
        .send({ ...dispatch, url })
        .catch((err: unknown) => err)) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(false);
      expect(redis.calls).toEqual([]);
    });
  });

  describe("given a scope already over the hourly dispatch cap", () => {
    /** @scenario "The dispatch cap is counted where the whole fleet can see it" */
    it("backs off retryably, counting under the key both graphs share", async () => {
      const redis = countingRedis(1001);
      const transport = createWorkerWebhookTransport({
        config: resolveWorkerConfig(ENVIRONMENT),
        redis: redis.connection,
      });

      const error = (await transport
        .send({ ...dispatch, url: "https://receiver.example.com/hook" })
        .catch((err: unknown) => err)) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBeGreaterThan(0);
      expect(redis.calls).toEqual(["langwatch:ratelimit:webhook-dispatch:project-1"]);
    });
  });

  describe("given the receiver's answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("classifies it the way the queue reads a delivery", () => {
      const transport = createWorkerWebhookTransport({
        config: resolveWorkerConfig(ENVIRONMENT),
      });
      const result = { status: 500, body: "boom", eventId: "evt_1" };

      expect(() =>
        transport.assertDelivered({ result: { ...result, status: 200 }, triggerName: "x" }),
      ).not.toThrow();
      try {
        transport.assertDelivered({ result, triggerName: "x" });
        throw new Error("expected the assertion to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DispatchError);
        expect((error as DispatchError).retryable).toBe(true);
      }
    });
  });
});

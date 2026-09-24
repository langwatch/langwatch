/**
 * The test-delivery door's per-organization window: counted ahead of
 * dispatch, refused 429 past the caller tier's ceiling, never reached on a refusal.
 * @vitest-environment node
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import { describe, expect, it, vi } from "vitest";

import type { WebhookDispatchResult } from "../../app/webhook.app.ts";
import { WebhookTestBoundsService } from "../../services/webhook-test-bounds.service.ts";
import { mountWebhookRest } from "./webhook-rest.harness.ts";

// The registry's free-tier webhookTestPerMinute, stated literally: a registry
// change fails this suite rather than silently re-deriving the new number.
const FREE_TESTS_PER_MINUTE = 10;

/** A real fixed window: each key counts its own checks, refused past the allowance named. */
function windowLimiter(): RateLimiter {
  const used = new Map<string, number>();

  return {
    check: (key, limit) => {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      const requests = limit?.requests ?? Number.POSITIVE_INFINITY;

      return Promise.resolve(
        count <= requests ? { allowed: true } : { allowed: false, retryAfterSeconds: 30 },
      );
    },
  };
}

/** The plan the one organization answers: the registry's free or enterprise number verbatim. */
function entitlementOf(planType: "FREE" | "ENTERPRISE"): Pick<EntitlementApi, "requestBound"> {
  const bound = planType === "FREE" ? 10 : 40;

  return {
    requestBound: ({ key }) => {
      if (key !== "webhookTestPerMinute") throw new Error(`unexpected bound: ${key}`);

      return Promise.resolve(bound);
    },
  };
}

function mountWithPlan(planType: "FREE" | "ENTERPRISE") {
  const dispatch = vi.fn(async (): Promise<WebhookDispatchResult> => ({
    verdict: "success",
    status: 200,
    body: "ok",
    dispatchId: "dispatch-1",
  }));

  const { request } = mountWebhookRest({
    endpoints: {
      findSigningSecrets: async () => [],
      getDestinationConfig: async () => ({ kind: "http", url: "https://example.test/hook" }),
      recordDeliveryAttempt: async () => {},
    } as never,
    dispatch,
    testFireBounds: WebhookTestBoundsService.create({
      entitlement: entitlementOf(planType),
      rateLimiter: windowLimiter(),
    }),
  });

  const fire = () =>
    request(`/api/webhooks/v1/endpoints/endpoint-1/test`, { method: "POST", body: "{}" });

  return { fire, dispatch };
}

describe("POST /api/webhooks/v1/endpoints/:id/test", () => {
  describe("given a free-tier organization at its test-fire ceiling", () => {
    it("refuses the next fire 429 and never dispatches it", async () => {
      const { fire, dispatch } = mountWithPlan("FREE");
      for (let index = 0; index < FREE_TESTS_PER_MINUTE; index++) {
        const response = await fire();
        expect(response.status).toBe(200);
      }
      expect(dispatch).toHaveBeenCalledTimes(FREE_TESTS_PER_MINUTE);

      const refused = await fire();

      expect(refused.status).toBe(429);
      const body = (await refused.json()) as { code: string };
      expect(body.code).toBe("webhook_test_rate_limited");
      expect(dispatch).toHaveBeenCalledTimes(FREE_TESTS_PER_MINUTE);
    });
  });

  describe("given an enterprise organization past the free ceiling", () => {
    it("still delivers: the ceiling is tier-resolved, not static", async () => {
      const { fire } = mountWithPlan("ENTERPRISE");
      for (let index = 0; index < FREE_TESTS_PER_MINUTE; index++) {
        await fire();
      }

      const response = await fire();

      expect(response.status).toBe(200);
    });
  });
});

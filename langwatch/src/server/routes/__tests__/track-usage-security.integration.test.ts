/**
 * @vitest-environment node
 *
 * Regression guard for POST /api/track_usage. The endpoint is intentionally
 * public (self-hosted instances have no credential to present), but it
 * previously accepted any event name/shape with no rate limiting — an
 * unauthenticated caller could inject arbitrary events into the analytics
 * pipeline at unlimited volume. The fix allowlists the one event self-hosted
 * deployments actually send, bounds the payload, and rate-limits per-IP and
 * per-instance.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ServerRedis from "~/server/redis";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerRedis>();
  return { ...actual, connection: null };
});
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) => text,
}));

const capture = vi.fn();
vi.mock("~/server/posthog", () => ({
  getPostHogInstance: () => ({ capture }),
}));

import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import { app } from "../misc";

beforeEach(() => {
  vi.clearAllMocks();
  _resetMemoryRateLimitStore();
});

function request({
  body,
  ip = "203.0.113.5",
}: {
  body: unknown;
  ip?: string;
}) {
  return app.request("/api/track_usage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/track_usage", () => {
  describe("when the event is the allowlisted daily_usage_stats report", () => {
    it("accepts it and forwards to PostHog", async () => {
      const res = await request({
        body: {
          event: "daily_usage_stats",
          instance_id: "acme__org_1",
          totalTraces: 42,
        },
      });

      expect(res.status).toBe(200);
      expect(capture).toHaveBeenCalledWith({
        distinctId: "acme__org_1",
        event: "daily_usage_stats",
        properties: { totalTraces: 42 },
      });
    });
  });

  describe("when the event name is not on the allowlist", () => {
    it("rejects with 400 and never calls PostHog", async () => {
      const res = await request({
        body: {
          event: "arbitrary_spoofed_event",
          instance_id: "attacker",
          marker: "single",
        },
      });

      expect(res.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  describe("when instance_id is missing", () => {
    it("rejects with 400", async () => {
      const res = await request({ body: { event: "daily_usage_stats" } });
      expect(res.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  describe("when the body is not valid JSON", () => {
    it("rejects with 400", async () => {
      const res = await app.request("/api/track_usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.5",
        },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("when properties exceed the field-count cap", () => {
    it("rejects with 400", async () => {
      const body: Record<string, unknown> = {
        event: "daily_usage_stats",
        instance_id: "acme__org_1",
      };
      for (let i = 0; i < 40; i++) body[`field_${i}`] = i;

      const res = await request({ body });
      expect(res.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  describe("when a single caller floods the endpoint", () => {
    it("returns 429 once the per-IP window is exhausted", async () => {
      // Distinct instance_id per request so the per-instance bucket (5/hour)
      // never trips first — this test isolates the per-IP bucket (10/minute).
      const ip = "203.0.113.9";

      for (let i = 0; i < 10; i++) {
        const ok = await request({
          body: { event: "daily_usage_stats", instance_id: `acme__org_${i}` },
          ip,
        });
        expect(ok.status).toBe(200);
      }

      const limited = await request({
        body: { event: "daily_usage_stats", instance_id: "acme__org_last" },
        ip,
      });
      expect(limited.status).toBe(429);
      expect(capture).toHaveBeenCalledTimes(10);
    });
  });

  describe("when a single instance_id is spammed from rotating IPs", () => {
    it("returns 429 once the per-instance window is exhausted", async () => {
      const body = { event: "daily_usage_stats", instance_id: "acme__org_1" };

      for (let i = 0; i < 5; i++) {
        const ok = await request({ body, ip: `203.0.113.${i}` });
        expect(ok.status).toBe(200);
      }

      const limited = await request({ body, ip: "203.0.113.99" });
      expect(limited.status).toBe(429);
      expect(capture).toHaveBeenCalledTimes(5);
    });
  });
});

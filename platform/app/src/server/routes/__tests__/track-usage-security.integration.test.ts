/**
 * @vitest-environment node
 *
 * Regression guard for POST /api/track_usage (security report). The endpoint
 * is intentionally public (self-hosted instances have no credential to
 * present), but it previously accepted any event name/shape at unlimited
 * volume — an unauthenticated caller could inject arbitrary events into the
 * analytics pipeline. The fix allowlists the one event self-hosted
 * deployments actually send with a `.strict()` schema (no smuggled
 * properties), bounds the payload size, and rate-limits globally, per-IP, and
 * per-instance.
 *
 * @regression
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AppLayerApp from "~/server/app-layer/app";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/app-layer/app", async (importOriginal) => {
  const actual = await importOriginal<typeof AppLayerApp>();
  // misc.ts reads its connection through tryGetApp; pin both so the no-Redis
  // path is chosen explicitly rather than by whatever the real one returns.
  return {
    ...actual,
    getApp: () => ({ redis: null }),
    tryGetApp: () => ({ redis: null }),
  };
});
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) => text,
}));

const capture = vi.fn();
vi.mock("~/server/posthog", () => ({
  getPostHogInstance: () => ({ capture }),
}));

// The registry of self-hosted installs, stood in for so this file can say what
// the route hands it without reaching a database.
const recordReport = vi.fn();
vi.mock("@ee/telemetry/instances/composition", () => ({
  createSelfHostedInstanceService: () => ({ recordReport }),
}));

import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import { app } from "../misc";

beforeEach(() => {
  vi.clearAllMocks();
  _resetMemoryRateLimitStore();
});

const VALID_STATS_FIELDS = {
  totalTraces: 0,
  totalScenarioEvents: 0,
  annotations: 0,
  annotationQueues: 0,
  annotationQueueItems: 0,
  annotationScores: 0,
  batchEvaluations: 0,
  customGraphs: 0,
  datasets: 0,
  datasetRecords: 0,
  experiments: 0,
  triggers: 0,
  workflows: 0,
};

function dailyUsageStatsBody(overrides: Record<string, unknown> = {}) {
  return {
    event: "daily_usage_stats",
    instance_id: "acme__org_1",
    ...VALID_STATS_FIELDS,
    ...overrides,
  };
}

function request({ body, ip = "203.0.113.5" }: { body: unknown; ip?: string }) {
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
    /** @scenario An install on an older version still reaches the old statistics route */
    it("accepts it and forwards exactly the known fields to PostHog", async () => {
      const res = await request({
        body: dailyUsageStatsBody({ totalTraces: 42 }),
      });

      expect(res.status).toBe(200);
      expect(capture).toHaveBeenCalledWith({
        distinctId: "acme__org_1",
        event: "daily_usage_stats",
        properties: {
          ...VALID_STATS_FIELDS,
          totalTraces: 42,
          unknown_fields: 0,
        },
      });
    });
  });

  describe("when the report is accepted", () => {
    /** @scenario "The first report from an install creates its row" */
    it("hands the registry the validated report and the instance it came from", async () => {
      const res = await request({
        body: dailyUsageStatsBody({
          totalTraces: 42,
          injected_marker: "attacker-controlled",
        }),
      });

      expect(res.status).toBe(200);
      expect(recordReport).toHaveBeenCalledTimes(1);
      const stored = recordReport.mock.calls[0]?.[0] as {
        instanceId: string;
        properties: Record<string, unknown>;
        unknownFields: number;
      };
      expect(stored.instanceId).toBe("acme__org_1");
      expect(stored.properties.totalTraces).toBe(42);
      expect(stored.properties.injected_marker).toBeUndefined();
      expect(stored.unknownFields).toBe(1);
    });
  });

  describe("when the database refuses the write", () => {
    /** @scenario "Storage failing never refuses the report" */
    it("answers the install as though the report had landed", async () => {
      // Refusing here would take the install with it: a 500 on a day of
      // storage trouble turns into a gap in every install's history, and the
      // report is the only thing that tells us an install exists.
      recordReport.mockRejectedValueOnce(new Error("connection refused"));

      const res = await request({ body: dailyUsageStatsBody() });

      expect(res.status).toBe(200);
      expect(capture).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the event name is not on the allowlist", () => {
    it("rejects with 400 and never calls PostHog", async () => {
      const res = await request({
        body: dailyUsageStatsBody({ event: "arbitrary_spoofed_event" }),
      });

      expect(res.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  describe("when instance_id is missing", () => {
    it("rejects with 400", async () => {
      const { instance_id: _drop, ...body } = dailyUsageStatsBody();
      const res = await request({ body });
      expect(res.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });
  });

  describe("when the body carries a property outside the known schema", () => {
    /** @scenario "The receiver accepts a report carrying a field it has never heard of" */
    it("accepts the report and drops the extra field before recording it", async () => {
      // A newer install naming a metric this release has never heard of is
      // the ordinary case, not an attack: refusing it would take that
      // install's telemetry with it, permanently. Dropping the field keeps
      // the security property, because nothing outside the known set is ever
      // recorded, and the count says the senders are ahead of this receiver.
      const res = await request({
        body: dailyUsageStatsBody({ injected_marker: "attacker-controlled" }),
      });

      expect(res.status).toBe(200);
      expect(capture).toHaveBeenCalledTimes(1);
      const properties = capture.mock.calls[0]?.[0]?.properties as Record<
        string,
        unknown
      >;
      expect(properties.injected_marker).toBeUndefined();
      expect(properties.unknown_fields).toBe(1);
    });
  });

  describe("when an older self-hosted sender omits stat fields this receiver added later", () => {
    /** @scenario "The receiver accepts a report missing fields it expects" */
    it("accepts the partial report rather than 400ing every field-set drift", async () => {
      // This is a stable receiver contract: self-hosted instances at any
      // version hit it, so a shape older than today's collectUsageStats.ts,
      // from before totalScenarioEvents was added, must still be accepted.
      const res = await request({
        body: {
          event: "daily_usage_stats",
          instance_id: "legacy-sender__org_1",
          totalTraces: 1,
        },
      });

      expect(res.status).toBe(200);
      expect(capture).toHaveBeenCalledWith({
        distinctId: "legacy-sender__org_1",
        event: "daily_usage_stats",
        properties: { totalTraces: 1, unknown_fields: 0 },
      });
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

  describe("when a single caller floods the endpoint", () => {
    it("returns 429 with Retry-After once the per-IP window is exhausted", async () => {
      // Distinct instance_id per request so the per-instance bucket (5/hour)
      // never trips first — this test isolates the per-IP bucket (10/minute).
      const ip = "203.0.113.9";

      for (let i = 0; i < 10; i++) {
        const ok = await request({
          body: dailyUsageStatsBody({ instance_id: `acme__org_${i}` }),
          ip,
        });
        expect(ok.status).toBe(200);
      }

      const limited = await request({
        body: dailyUsageStatsBody({ instance_id: "acme__org_last" }),
        ip,
      });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(capture).toHaveBeenCalledTimes(10);
    });
  });

  describe("when a single instance_id is spammed from rotating IPs", () => {
    it("returns 429 once the per-instance window is exhausted", async () => {
      const body = dailyUsageStatsBody();

      for (let i = 0; i < 5; i++) {
        const ok = await request({ body, ip: `203.0.113.${i}` });
        expect(ok.status).toBe(200);
      }

      const limited = await request({ body, ip: "203.0.113.99" });
      expect(limited.status).toBe(429);
      expect(capture).toHaveBeenCalledTimes(5);
    });
  });

  describe("when traffic is distributed across rotating IPs and instance ids", () => {
    it("returns 429 once the global window is exhausted", async () => {
      // Every request uses a fresh IP and a fresh instance_id — defeating
      // both the per-IP and per-instance buckets by construction — so only
      // the global cap (500/minute) can be the thing that trips.
      for (let i = 0; i < 500; i++) {
        const ok = await request({
          body: dailyUsageStatsBody({ instance_id: `acme__org_${i}` }),
          ip: `10.0.${Math.floor(i / 256)}.${i % 256}`,
        });
        expect(ok.status).toBe(200);
      }

      const limited = await request({
        body: dailyUsageStatsBody({ instance_id: "acme__org_last" }),
        ip: "10.0.2.0",
      });
      expect(limited.status).toBe(429);
      expect(capture).toHaveBeenCalledTimes(500);
    });
  });
});

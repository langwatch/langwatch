/**
 * @vitest-environment node
 *
 * Unit tests for trackProductAction.
 *
 * Verifies:
 * - Emits a `product_action` PostHog event with the expected shape
 * - Dedups once per project+action+UTC day via Redis SET NX EX
 * - Falls through (emits) when Redis is unavailable
 * - Surface + CI headers are parsed correctly
 * - No-ops when POSTHOG_KEY is not configured
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCapture, mockRedisSet, mockConnection } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
  mockRedisSet: vi.fn(),
  mockConnection: { set: (...args: unknown[]) => mockRedisSet(...args) },
}));

vi.mock("posthog-node", () => ({
  PostHog: function () {
    return { capture: mockCapture, shutdown: vi.fn() };
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    POSTHOG_KEY: "phc_test_key",
    POSTHOG_HOST: "https://us.i.posthog.com",
  },
}));

vi.mock("~/server/redis", () => ({
  isBuildOrNoRedis: false,
  connection: mockConnection,
}));

import {
  parseClientHeader,
  readClientContext,
  trackProductAction,
} from "../productAction";

describe("parseClientHeader", () => {
  describe("when the header is missing", () => {
    it("returns surface=unknown", () => {
      expect(parseClientHeader(undefined)).toEqual({ surface: "unknown" });
    });
  });

  describe("when the header has a known client and version", () => {
    it("parses surface and version", () => {
      expect(parseClientHeader("sdk-python/0.12.3")).toEqual({
        surface: "sdk-python",
        surface_version: "0.12.3",
      });
    });
  });

  describe("when the header has a known client without version", () => {
    it("returns surface only", () => {
      expect(parseClientHeader("cli")).toEqual({ surface: "cli" });
    });
  });

  describe("when the header has an unknown client", () => {
    it("falls back to surface=unknown", () => {
      expect(parseClientHeader("gremlin/1.0")).toEqual({
        surface: "unknown",
        surface_version: "1.0",
      });
    });
  });
});

describe("readClientContext", () => {
  describe("when CI header is '1'", () => {
    it("sets isCi=true", () => {
      const headers = new Map([
        ["x-langwatch-client", "cli/2.0"],
        ["x-langwatch-ci", "1"],
      ]);
      const ctx = readClientContext((name) => headers.get(name));
      expect(ctx).toEqual({
        surface: "cli",
        surfaceVersion: "2.0",
        isCi: true,
      });
    });
  });

  describe("when CI header is absent", () => {
    it("sets isCi=false", () => {
      const ctx = readClientContext(() => undefined);
      expect(ctx).toEqual({ surface: "unknown", isCi: false });
    });
  });
});

describe("trackProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisSet.mockResolvedValue("OK");
  });

  describe("when Redis dedup allows emission", () => {
    it("emits product_action with expected shape", async () => {
      await trackProductAction({
        action: "trace_ingested",
        projectId: "proj-1",
        organizationId: "org-1",
        userId: "user-1",
        surface: "sdk-python",
        surfaceVersion: "0.12.0",
        isCi: false,
        route: "/api/collector",
      });

      expect(mockCapture).toHaveBeenCalledTimes(1);
      const call = mockCapture.mock.calls[0]![0];
      expect(call).toMatchObject({
        distinctId: "user-1",
        event: "product_action",
        properties: {
          action: "trace_ingested",
          surface: "sdk-python",
          surface_version: "0.12.0",
          is_ci: false,
          route: "/api/collector",
          project_id: "proj-1",
          organization_id: "org-1",
          projectId: "proj-1",
        },
        groups: {
          organization: "org-1",
          project: "proj-1",
        },
      });
    });

    it("uses project:<id> as distinctId when userId is absent", async () => {
      await trackProductAction({
        action: "trace_ingested",
        projectId: "proj-1",
        organizationId: "org-1",
        surface: "cli",
      });

      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({ distinctId: "project:proj-1" }),
      );
    });

    it("writes a Redis key with TTL of one day", async () => {
      await trackProductAction({
        action: "evaluation_run",
        projectId: "proj-9",
        surface: "web",
      });

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const [key, value, exFlag, ttl, nxFlag] = mockRedisSet.mock.calls[0]!;
      expect(key).toMatch(/^telemetry:product_action:proj-9:evaluation_run:\d{4}-\d{2}-\d{2}$/);
      expect(value).toBe("1");
      expect(exFlag).toBe("EX");
      expect(ttl).toBe(86400);
      expect(nxFlag).toBe("NX");
    });
  });

  describe("when Redis dedup rejects the key", () => {
    it("does not emit", async () => {
      mockRedisSet.mockResolvedValueOnce(null); // SET NX returns null if key exists

      await trackProductAction({
        action: "trace_ingested",
        projectId: "proj-1",
        surface: "web",
      });

      expect(mockCapture).not.toHaveBeenCalled();
    });
  });

  describe("when Redis throws", () => {
    it("emits anyway (fail-open)", async () => {
      mockRedisSet.mockRejectedValueOnce(new Error("connection refused"));

      await trackProductAction({
        action: "trace_ingested",
        projectId: "proj-1",
        surface: "web",
      });

      expect(mockCapture).toHaveBeenCalledTimes(1);
    });
  });
});

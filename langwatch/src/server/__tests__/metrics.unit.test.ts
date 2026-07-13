/**
 * @vitest-environment node
 *
 * Covers the two pieces of `~/server/metrics` that both the web process
 * (start.ts `/metrics` + `/workers/metrics` proxy) and the worker process
 * (workers.ts metrics listener) depend on:
 *
 * - `getWorkerMetricsPort` — port derivation + validation, relocated from
 *   the deleted `src/server/background/config.ts` (suite restored from its
 *   deleted config.test.ts).
 * - `isMetricsAuthorized` — the shared bearer-token gate, including the
 *   fail-closed production branch.
 */
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKER_METRICS_PORT,
  getWorkerMetricsPort,
  isMetricsAuthorized,
  normalizeMetricsPath,
} from "../metrics";

function requestWithAuth(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as IncomingMessage;
}

describe("getWorkerMetricsPort", () => {
  const originalMetricsEnv = process.env.WORKER_METRICS_PORT;
  const originalPortEnv = process.env.PORT;

  beforeEach(() => {
    delete process.env.WORKER_METRICS_PORT;
    delete process.env.PORT;
  });

  afterEach(() => {
    if (originalMetricsEnv === undefined) {
      delete process.env.WORKER_METRICS_PORT;
    } else {
      process.env.WORKER_METRICS_PORT = originalMetricsEnv;
    }
    if (originalPortEnv === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPortEnv;
    }
  });

  describe("when WORKER_METRICS_PORT is not set", () => {
    it("returns 2999 when PORT is also unset", () => {
      expect(getWorkerMetricsPort()).toBe(DEFAULT_WORKER_METRICS_PORT);
    });

    it("derives default from PORT (PORT - 2561) so non-default slots don't collide", () => {
      process.env.PORT = "5570";
      expect(getWorkerMetricsPort()).toBe(3009);
    });

    it("falls back to 2999 when PORT is non-numeric", () => {
      process.env.PORT = "banana";
      expect(getWorkerMetricsPort()).toBe(DEFAULT_WORKER_METRICS_PORT);
    });
  });

  describe("when WORKER_METRICS_PORT is set", () => {
    it("returns the configured port", () => {
      process.env.WORKER_METRICS_PORT = "3001";
      expect(getWorkerMetricsPort()).toBe(3001);
    });

    it("overrides the PORT-derived default", () => {
      process.env.PORT = "5570";
      process.env.WORKER_METRICS_PORT = "4242";
      expect(getWorkerMetricsPort()).toBe(4242);
    });

    it("throws an error for non-numeric port values", () => {
      process.env.WORKER_METRICS_PORT = "banana";
      expect(() => getWorkerMetricsPort()).toThrow(
        'Invalid WORKER_METRICS_PORT: "banana"',
      );
    });

    it("throws an error for port below valid range", () => {
      process.env.WORKER_METRICS_PORT = "0";
      expect(() => getWorkerMetricsPort()).toThrow(
        'Invalid WORKER_METRICS_PORT: "0"',
      );
    });

    it("throws an error for port above valid range", () => {
      process.env.WORKER_METRICS_PORT = "999999";
      expect(() => getWorkerMetricsPort()).toThrow(
        'Invalid WORKER_METRICS_PORT: "999999"',
      );
    });

    it("accepts valid port at lower boundary", () => {
      process.env.WORKER_METRICS_PORT = "1";
      expect(getWorkerMetricsPort()).toBe(1);
    });

    it("accepts valid port at upper boundary", () => {
      process.env.WORKER_METRICS_PORT = "65535";
      expect(getWorkerMetricsPort()).toBe(65535);
    });
  });
});

describe("isMetricsAuthorized", () => {
  const originalMetricsApiKey = process.env.METRICS_API_KEY;

  beforeEach(() => {
    delete process.env.METRICS_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalMetricsApiKey === undefined) {
      delete process.env.METRICS_API_KEY;
    } else {
      process.env.METRICS_API_KEY = originalMetricsApiKey;
    }
  });

  describe("when NODE_ENV is production and METRICS_API_KEY is unset", () => {
    it("fails closed by throwing", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(() => isMetricsAuthorized(requestWithAuth())).toThrow(
        "METRICS_API_KEY is not set",
      );
    });
  });

  describe("when METRICS_API_KEY is set", () => {
    beforeEach(() => {
      process.env.METRICS_API_KEY = "the-metrics-key";
    });

    it("authorizes a matching bearer token", () => {
      expect(
        isMetricsAuthorized(requestWithAuth("Bearer the-metrics-key")),
      ).toBe(true);
    });

    it("rejects a mismatched bearer token", () => {
      expect(isMetricsAuthorized(requestWithAuth("Bearer wrong-key"))).toBe(
        false,
      );
    });

    it("rejects a request with no Authorization header", () => {
      expect(isMetricsAuthorized(requestWithAuth())).toBe(false);
    });

    it("authorizes a matching bearer token in production too", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(
        isMetricsAuthorized(requestWithAuth("Bearer the-metrics-key")),
      ).toBe(true);
    });
  });

  describe("when METRICS_API_KEY is unset outside production", () => {
    it("allows access for dev convenience", () => {
      expect(isMetricsAuthorized(requestWithAuth())).toBe(true);
    });
  });
});

describe("normalizeMetricsPath", () => {
  describe("when the path carries entity IDs", () => {
    it("collapses prefixed entity ids to {id}", () => {
      expect(normalizeMetricsPath("/api/traces/trace_MWS36ZJSXeAGyj5zXLk7M")).toBe(
        "/api/traces/{id}",
      );
      expect(normalizeMetricsPath("/api/prompts/prompt_Ab12Cd34Ef56")).toBe(
        "/api/prompts/{id}",
      );
    });

    it("collapses hex trace ids to {id}", () => {
      expect(
        normalizeMetricsPath("/api/trace/search/traces/957239e7ddb315d5518a4792601c3d67"),
      ).toBe("/api/trace/search/traces/{id}");
    });

    it("collapses uuids to {id}", () => {
      expect(
        normalizeMetricsPath(
          "/api/evaluations/v3/runs/e07e9880-edb4-458b-94d8-5f179468f096/results",
        ),
      ).toBe("/api/evaluations/v3/runs/{id}/results");
    });

    it("collapses numeric segments to {id}", () => {
      expect(normalizeMetricsPath("/api/experiments/12345")).toBe(
        "/api/experiments/{id}",
      );
    });

    it("collapses percent-encoded segments to {id}", () => {
      expect(normalizeMetricsPath("/api/traces/dHJhY2VfQUJD%3D%3D")).toBe(
        "/api/traces/{id}",
      );
    });

    it("collapses unprefixed nanoid tokens to {id}", () => {
      expect(normalizeMetricsPath("/share/oS6jK-KV33KjjGwZ1aKq8")).toBe(
        "/share/{id}",
      );
    });

    it("keeps the id inside a longer route template", () => {
      expect(normalizeMetricsPath("/api/trace/trace_A1b2C3d4E5f6/share")).toBe(
        "/api/trace/{id}/share",
      );
    });
  });

  describe("when the path is a static route", () => {
    it("keeps route words untouched", () => {
      expect(normalizeMetricsPath("/api/evaluations/list")).toBe(
        "/api/evaluations/list",
      );
      expect(normalizeMetricsPath("/api/prompts/tags/production")).toBe(
        "/api/prompts/tags/production",
      );
    });

    it("keeps underscore route words that look nothing like ids", () => {
      expect(normalizeMetricsPath("/api/topics/batch_clustering")).toBe(
        "/api/topics/batch_clustering",
      );
    });

    it("keeps the root path", () => {
      expect(normalizeMetricsPath("/")).toBe("/");
    });
  });

  describe("when the path has duplicate slashes", () => {
    it("collapses them so the same route maps to one label", () => {
      expect(normalizeMetricsPath("/api//traces/trace_A1b2C3d4E5f6")).toBe(
        "/api/traces/{id}",
      );
    });
  });
});

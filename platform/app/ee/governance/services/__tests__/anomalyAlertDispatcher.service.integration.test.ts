/**
 * @vitest-environment node
 *
 * Integration coverage for the C3 alert-dispatch fan-out
 * (`AnomalyAlertDispatcherService`). Hits real Postgres
 * (testcontainers) for persistence; HTTP is exercised through an
 * injected fetch double so the test stays hermetic and fast.
 *
 * Pins:
 *   1. Happy-path: each configured webhook receives a structured POST
 *      with the alert payload + Content-Type JSON.
 *   2. HMAC: when sharedSecret is set, X-LangWatch-Signature is
 *      `sha256=<hex>` of HMAC-SHA256(body, sharedSecret); without
 *      sharedSecret the header is absent.
 *   3. Multi-destination fan-out: failure on one destination doesn't
 *      stop the others; tag summary reflects per-dest outcomes.
 *   4. Transient retry: 503 once → 200 once succeeds; permanent 500
 *      gives up after MAX_RETRIES with a failed outcome.
 *   5. Quarantine: legacy/malformed destinationConfig falls back to
 *      log-only (`log_only_invalid_config`) without POSTing.
 *   6. Empty / missing config: explicit log-only behavior, no POST.
 *
 * Spec: specs/ai-gateway/governance/c3-alert-dispatch.feature
 */
import { createHmac } from "node:crypto";

import type { AnomalyAlert, AnomalyRule } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import {
  AnomalyAlertDispatcherService,
  type FetchLike,
} from "../activity-monitor/anomalyAlertDispatcher.service";

const ns = `c3-${nanoid(8)}`;

let organizationId: string;

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `C3 Org ${ns}`, slug: `--c3-${ns}` },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.anomalyAlert.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.anomalyRule.deleteMany({ where: { organizationId } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { slug: `--c3-${ns}` } }).catch(() => {});
});

async function seedRuleAndAlert({
  destinationConfig,
}: {
  destinationConfig: Record<string, unknown> | undefined;
}): Promise<{ rule: AnomalyRule; alert: AnomalyAlert }> {
  const rule = await prisma.anomalyRule.create({
    data: {
      organizationId,
      name: `rule-${nanoid(4)}`,
      severity: "warning",
      ruleType: "spend_spike",
      scope: "organization",
      scopeId: organizationId,
      thresholdConfig: {
        windowSec: 3600,
        ratioVsBaseline: 2.0,
        minBaselineUsd: 1.0,
      },
      destinationConfig: (destinationConfig ?? {}) as Prisma.InputJsonValue,
      status: "active",
    },
  });
  const alert = await prisma.anomalyAlert.create({
    data: {
      organizationId,
      ruleId: rule.id,
      severity: "warning",
      ruleName: rule.name,
      ruleType: rule.ruleType,
      triggerWindowStart: new Date("2026-01-01T00:00:00Z"),
      triggerWindowEnd: new Date("2026-01-01T01:00:00Z"),
      triggerSpendUsd: new Prisma.Decimal("123.456"),
      triggerEventCount: null,
      detail: { reason: "test" },
      state: "open",
    },
  });
  return { rule, alert };
}

type FetchCall = { url: string; headers: Record<string, string>; body: string };

function makeFetchSpy(
  responder: (call: FetchCall, callIndex: number) => {
    status: number;
    statusText?: string;
  },
): { fetchImpl: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: FetchCall = {
      url,
      headers: { ...init.headers },
      body: init.body,
    };
    calls.push(call);
    const result = responder(call, calls.length - 1);
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      statusText: result.statusText ?? "",
    };
  };
  return { fetchImpl, calls };
}

describe("AnomalyAlertDispatcherService.dispatchAlert", () => {
  describe("happy path", () => {
    it("POSTs JSON body with alert payload to the configured webhook", async () => {
      const { rule, alert } = await seedRuleAndAlert({
        destinationConfig: {
          destinations: [{ type: "webhook", url: "https://hooks.example.com/lw" }],
        },
      });

      const { fetchImpl, calls } = makeFetchSpy(() => ({ status: 200 }));
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      const result = await dispatcher.dispatchAlert({ rule, alert });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://hooks.example.com/lw");
      expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
      expect(calls[0]?.headers["X-LangWatch-Signature"]).toBeUndefined();

      const parsed = JSON.parse(calls[0]!.body);
      expect(parsed).toMatchObject({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: "spend_spike",
        severity: "warning",
        organizationId: rule.organizationId,
        alert: {
          id: alert.id,
          triggerWindowStartIso: alert.triggerWindowStart.toISOString(),
          triggerWindowEndIso: alert.triggerWindowEnd.toISOString(),
        },
      });

      expect(result.dispatchTag).toBe("dispatched_webhook_1");
      expect(result.outcomes).toEqual([
        { destinationIndex: 0, type: "webhook", status: "succeeded" },
      ]);
    });
  });

  describe("HMAC signing", () => {
    it("includes X-LangWatch-Signature: sha256=<hex> when sharedSecret is set", async () => {
      const { rule, alert } = await seedRuleAndAlert({
        destinationConfig: {
          destinations: [
            {
              type: "webhook",
              url: "https://hooks.example.com/signed",
              sharedSecret: "S3CR3T",
            },
          ],
        },
      });

      const { fetchImpl, calls } = makeFetchSpy(() => ({ status: 200 }));
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      await dispatcher.dispatchAlert({ rule, alert });

      const sig = calls[0]?.headers["X-LangWatch-Signature"];
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
      const expected =
        "sha256=" +
        createHmac("sha256", "S3CR3T").update(calls[0]!.body).digest("hex");
      expect(sig).toBe(expected);
    });
  });

  describe("multi-destination fan-out", () => {
    it("dispatches to all and reports per-dest outcomes when one fails", async () => {
      const { rule, alert } = await seedRuleAndAlert({
        destinationConfig: {
          destinations: [
            { type: "webhook", url: "https://primary.example.com/x" },
            { type: "webhook", url: "https://backup.example.com/x" },
          ],
        },
      });

      // Primary always 500 (permanent), backup 200. Each retried up to
      // MAX_RETRIES so primary will be hit 3x, backup 1x.
      const { fetchImpl, calls } = makeFetchSpy((call) => {
        if (call.url.includes("primary")) {
          return { status: 500, statusText: "Internal Server Error" };
        }
        return { status: 200 };
      });
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      const result = await dispatcher.dispatchAlert({ rule, alert });

      expect(calls.filter((c) => c.url.includes("primary")).length).toBe(3);
      expect(calls.filter((c) => c.url.includes("backup")).length).toBe(1);
      expect(result.outcomes).toHaveLength(2);
      expect(result.outcomes[0]).toMatchObject({
        destinationIndex: 0,
        status: "failed",
      });
      expect(result.outcomes[1]).toMatchObject({
        destinationIndex: 1,
        status: "succeeded",
      });
      expect(result.dispatchTag).toBe("dispatched_webhook_1_failed_1");
    });
  });

  describe("retry behavior", () => {
    it("retries on transient 5xx and reports succeeded once a retry returns 200", async () => {
      const { rule, alert } = await seedRuleAndAlert({
        destinationConfig: {
          destinations: [{ type: "webhook", url: "https://flaky.example.com/x" }],
        },
      });

      let n = 0;
      const { fetchImpl, calls } = makeFetchSpy(() => {
        n += 1;
        return n === 1 ? { status: 503, statusText: "Try again" } : { status: 200 };
      });
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      const result = await dispatcher.dispatchAlert({ rule, alert });

      expect(calls.length).toBe(2);
      expect(result.outcomes[0]?.status).toBe("succeeded");
      expect(result.dispatchTag).toBe("dispatched_webhook_1");
    });

    it("does NOT retry on 4xx (config error, not transient)", async () => {
      const { rule, alert } = await seedRuleAndAlert({
        destinationConfig: {
          destinations: [{ type: "webhook", url: "https://wrong.example.com/x" }],
        },
      });

      const { fetchImpl, calls } = makeFetchSpy(() => ({
        status: 401,
        statusText: "Unauthorized",
      }));
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      const result = await dispatcher.dispatchAlert({ rule, alert });

      expect(calls.length).toBe(1);
      expect(result.outcomes[0]).toMatchObject({
        status: "failed",
        reason: expect.stringContaining("401"),
      });
      expect(result.dispatchTag).toBe("failed_webhook_1");
    });
  });

  describe("quarantine + opt-out", () => {
    it("quarantines a legacy / malformed destinationConfig as log-only without POSTing", async () => {
      // Pre-Phase-2C-C3 shape — bare object, not wrapped under
      // `destinations`. The schema rejects this and the dispatcher
      // logs a warning + falls back to log-only.
      const { rule, alert } = await seedRuleAndAlert({
        destinationConfig: { slack_channel: "#ops" } as Record<string, unknown>,
      });

      const { fetchImpl, calls } = makeFetchSpy(() => ({ status: 200 }));
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      const result = await dispatcher.dispatchAlert({ rule, alert });

      expect(calls.length).toBe(0);
      expect(result.dispatchTag).toBe("log_only_invalid_config");
      expect(result.outcomes).toEqual([]);
    });

    it("treats empty / missing destinationConfig as explicit opt-out (log_only)", async () => {
      const { rule, alert } = await seedRuleAndAlert({ destinationConfig: {} });

      const { fetchImpl, calls } = makeFetchSpy(() => ({ status: 200 }));
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      const result = await dispatcher.dispatchAlert({ rule, alert });

      expect(calls.length).toBe(0);
      expect(result.dispatchTag).toBe("log_only");
      expect(result.outcomes).toEqual([]);
    });

    it("treats an empty destinations array as log-only", async () => {
      const { rule, alert } = await seedRuleAndAlert({
        destinationConfig: { destinations: [] },
      });

      const { fetchImpl, calls } = makeFetchSpy(() => ({ status: 200 }));
      const dispatcher = AnomalyAlertDispatcherService.create(fetchImpl);

      const result = await dispatcher.dispatchAlert({ rule, alert });

      expect(calls.length).toBe(0);
      expect(result.dispatchTag).toBe("log_only");
    });
  });
});

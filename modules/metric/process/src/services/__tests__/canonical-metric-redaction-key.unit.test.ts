/**
 * Each metric point is redacted under its own key, so the PII redaction model's priced request
 * is one per point and not one per distinct attribute set (ADR-201).
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import { describe, expect, it } from "vitest";

import { prepareMetricDataPoints } from "../canonical-metric.service.ts";
import type { MetricRedaction } from "../metric-redaction.service.ts";
import { requestForMetric } from "./canonical-metric.fixture.ts";

const ATTRIBUTES = [{ key: "user.note", value: { stringValue: "called Jane Doe" } }];

function point(times: { startTimeUnixNano?: string; timeUnixNano: string }) {
  return { ...times, asDouble: 1, attributes: ATTRIBUTES };
}

/** The record keys the redaction port was handed, one per point, in order. */
async function recordKeysOf(
  dataPoints: Record<string, unknown>[],
): Promise<(string | undefined)[]> {
  const keys: (string | undefined)[] = [];
  const redaction: MetricRedaction = {
    redactMetricAttributes: async (metric) => {
      keys.push(metric.recordKey);
    },
  };
  await prepareMetricDataPoints(
    {
      tenantId: "project-1",
      organizationId: "organization-1",
      request: requestForMetric({ metric: { name: "http.requests", sum: { dataPoints } } }),
      piiRedactionLevel: "STRICT",
      acceptedAt: 1_800_000_000_000,
    },
    redaction,
  );

  return keys;
}

describe("given strict metric points", () => {
  /** @scenario "A metric point is keyed by its metric and its times" */
  it("keys a point by its metric, its start time and its time", async () => {
    await expect(
      recordKeysOf([
        point({ startTimeUnixNano: "1699999940000000000", timeUnixNano: "1700000000000000000" }),
      ]),
    ).resolves.toEqual(["metric:http.requests:1699999940000000000:1700000000000000000"]);
  });

  /** @scenario "A metric point is keyed by its metric and its times" */
  it("reads a missing start time as zero", async () => {
    await expect(recordKeysOf([point({ timeUnixNano: "1700000000000000000" })])).resolves.toEqual([
      "metric:http.requests:0:1700000000000000000",
    ]);
  });

  /** @scenario "A metric point is keyed by its metric and its times" */
  it("gives a retried export the same keys", async () => {
    const points = [point({ timeUnixNano: "1700000000000000000" })];

    await expect(recordKeysOf(points)).resolves.toEqual(await recordKeysOf(points));
  });

  /** @scenario "A metric point is keyed by its metric and its times" */
  it("gives the same attributes exported a minute later a different key", async () => {
    const [first, second] = await recordKeysOf([
      point({ timeUnixNano: "1700000000000000000" }),
      point({ timeUnixNano: "1700000060000000000" }),
    ]);

    expect(first).not.toBe(second);
  });
});

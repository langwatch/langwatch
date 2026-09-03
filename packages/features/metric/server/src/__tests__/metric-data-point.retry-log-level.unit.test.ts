/**
 * @vitest-environment node
 * A rethrow here is not this repository's outcome to claim — the worker
 * queue above it owns retries and terminal error logging.
 */
import { describe, expect, it, vi } from "vitest";
import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";
import type { MetricClickHouseClient } from "@langwatch/metric-server/testing";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

const { MetricDataPointClickHouseRepository } =
  await import("../repositories/clickhouse/clickhouse.metric-data-point.repository");

const REFUSED = new Error("Too many queries in flight");

function dataPoint(): CanonicalMetricDataPoint {
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    pointId: "a".repeat(64),
    seriesId: "b".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributeKeys: [],
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    metricName: "requests",
    metricDescription: "",
    metricUnit: "1",
    metricKind: "gauge",
    aggregationTemporality: "unspecified",
    isMonotonic: null,
    pointAttributesJson: "[]",
    pointAttributeKeys: [],
    startTimeUnixNano: "0",
    timeUnixNano: "1700000000000000000",
    timeUnixMs: 1_700_000_000_000,
    flags: 0,
    valueType: "double",
    valueInt: null,
    valueDouble: 1.5,
    count: null,
    sum: null,
    min: null,
    max: null,
    explicitBounds: [],
    bucketCounts: [],
    exponentialScale: null,
    exponentialZeroThreshold: null,
    zeroCount: null,
    positiveOffset: null,
    positiveBucketCounts: [],
    negativeOffset: null,
    negativeBucketCounts: [],
    summaryQuantilesJson: "[]",
    canonicalPayload: '{"point":{"value":1.5}}',
    canonicalSizeBytes: 23,
    occurredAt: 1_700_000_000_000,
    acceptedAt: 1_800_000_000_000,
  };
}

/** A client whose every insert is refused, the way a shedding pool refuses. */
function refusingClient(): MetricClickHouseClient {
  return {
    insert: async () => {
      throw REFUSED;
    },
    query: async () => ({
      json: async <Row>() => {
        const rows: Row[] = [];

        return rows;
      },
    }),
  };
}

function refusingRepository() {
  const client = refusingClient();

  return MetricDataPointClickHouseRepository.create({
    resolveClient: async () => client,
    resolveOrganizationClient: async () => client,
    defaultRetentionDays: 30,
  });
}

describe("canonical metric point writes", () => {
  describe("given a repository that rethrows for the queue to retry", () => {
    describe("when ClickHouse refuses the write", () => {
      /** @scenario "A ClickHouse write failure beneath the queue is a warning" */
      it("logs at warning level, not error", async () => {
        logger.warn.mockClear();
        logger.error.mockClear();

        await expect(
          refusingRepository().ensureDataPoints({ points: [dataPoint()] }),
        ).rejects.toThrow(REFUSED);

        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(1);
      });

      /** @scenario "A layer that rethrows logs below error" */
      it("keeps the identifiers only this layer holds", async () => {
        logger.warn.mockClear();

        await expect(
          refusingRepository().ensureDataPoints({ points: [dataPoint()] }),
        ).rejects.toThrow(REFUSED);

        // The instance itself, not merely some Error: a layer that wrapped or
        // recreated it would lose the original failure context while still
        // satisfying `expect.any(Error)`.
        expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
          tenantId: "project-1",
          pointCount: 1,
          error: REFUSED,
        });
      });
    });
  });
});

/**
 * @vitest-environment node
 * The metric append port answers alike over its memory twin and its ClickHouse backend: each
 * point handed to it is held, an empty batch holds nothing.
 * Spec: modules/metric/specs/metric-processing.feature
 */
import { describe, expect, it } from "vitest";

import { point } from "../../app/__tests__/metric.fixture.ts";
import type { MetricClickHouseClient } from "../clickhouse/clickhouse.metric-data-point-append.repository.ts";
import { MetricDataPointClickHouseRepository } from "../clickhouse/clickhouse.metric-data-point.repository.ts";
import { MemoryMetricDataPointAppendRepository } from "../memory/memory.metric-data-point-append.repository.ts";
import type { MetricDataPointAppendRepository } from "../metric-data-point-append.repository.ts";

type Backend = Readonly<{
  repository: MetricDataPointAppendRepository;
  held: () => number;
}>;

function contractCases(makeBackend: () => Backend): void {
  it("holds nothing for an empty batch", async () => {
    const backend = makeBackend();

    await backend.repository.ensureDataPoints({ points: [] });

    expect(backend.held()).toBe(0);
  });

  it("holds the one point it was given", async () => {
    const backend = makeBackend();

    await backend.repository.ensureDataPoint({ point: point({ timeUnixMs: 1_000 }) });

    expect(backend.held()).toBe(1);
  });

  it("holds every point of a batch", async () => {
    const backend = makeBackend();

    await backend.repository.ensureDataPoints({
      points: [point({ timeUnixMs: 1_000 }), point({ timeUnixMs: 2_000 })],
    });

    expect(backend.held()).toBe(2);
  });
}

describe("given the metric memory append repository", () => {
  contractCases(() => {
    const repository = MemoryMetricDataPointAppendRepository.create();
    return { repository, held: () => repository.points().length };
  });
});

describe("given the metric ClickHouse repository over a recording client", () => {
  contractCases(() => {
    let rows = 0;
    const client: MetricClickHouseClient = {
      insert: async ({ table, values }) => {
        if (table === "metric_data_points") rows += values.length;
      },
      query: async () => ({ json: async () => [] }),
    };
    const repository = MetricDataPointClickHouseRepository.create({
      resolveClient: async () => client,
      resolveOrganizationClient: async () => client,
      defaultRetentionDays: 30,
    });
    return { repository, held: () => rows };
  });
});

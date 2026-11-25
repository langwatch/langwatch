/**
 * The ingest measurement the judge's trace wait is sized from, on the production `stored_spans`
 * schema. See specs/scenarios/judge-trace-wait-settings.feature and ADR-097.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const TENANT = `ingest-lag-${nanoid()}`;
const TRACES = 25;
/** Each trace's spans arrive at these offsets from its start; the longest silence is 12s. */
const ARRIVALS_MS = [0, 1_000, 13_000];

let ch: ClickHouseClient;
let repository: ClickHouseTraceSpanRepository;

function spanRow({
  traceId,
  spanId,
  startTime,
  createdAt,
}: {
  traceId: string;
  spanId: string;
  startTime: number;
  createdAt: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: TENANT,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(startTime),
    EndTime: new Date(startTime + 50),
    DurationMs: 50,
    SpanName: "span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [] as Date[],
    "Events.Name": [] as string[],
    "Events.Attributes": [] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(createdAt),
    UpdatedAt: new Date(createdAt),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repository = ClickHouseTraceSpanRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
  const start = Date.now() - 60 * 60 * 1000;
  const rows = Array.from({ length: TRACES }, (_, trace) => {
    const traceId = `trace-${trace}-${nanoid()}`;
    const traceStart = start + trace * 60_000;
    const spans = ARRIVALS_MS.map((offset, index) =>
      spanRow({
        traceId,
        spanId: `span-${index}`,
        startTime: traceStart,
        createdAt: traceStart + offset,
      }),
    );
    return spans;
  }).flat();
  await ch.insert({
    table: "stored_spans",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
});

describe.skipIf(!clickHouseConfigured)("ClickHouseTraceSpanRepository.findIngestLag", () => {
  describe("given a week of traces whose spans arrive with a twelve second silence", () => {
    it("measures the p95 longest silence per trace beside the ingest lag", async () => {
      const sample = await repository.findIngestLag({
        authorization: ownProof({ projectId: TENANT }),
      });

      expect(sample).toMatchObject({ sampleCount: TRACES, arrivalGapSampleCount: TRACES });
      expect(sample?.p95ArrivalGapMs).toBeCloseTo(12_000, -2);
      expect(sample?.p95LagMs).toBeCloseTo(12_950, -2);
    });
  });
});

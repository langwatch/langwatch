/**
 * @vitest-environment node
 * @integration
 * Spec: modules/trace/specs/trace-lookup-by-id.feature - the store reads that let an existing
 * trace load by any id a caller holds for it, against a real ClickHouse.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { RetentionDaysProvider } from "@langwatch/clickhouse-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { STILL_INGESTING_ATTRIBUTE } from "../../../rules/trace-legacy-spans-only-summary.rules.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";
import { fencedOver } from "./support/legacy-trace-mapping.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-lookup-by-id-${nanoid()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const window = { from: now - 90 * DAY_MS, to: now + 60_000 };
const hexId = () =>
  nanoid(32)
    .replace(/[^a-f0-9]/gi, "0")
    .toLowerCase()
    .padEnd(32, "0");

const unfoldedTraceId = hexId();
const spannedTraceId = hexId();
const knownSpanId = "8f1c2d3e4a5b6c7d";
const scenarioTraceId = hexId();
const scenarioRunId = `scenariorun_${nanoid()}`;
const epochTraceId = hexId();
const oldTraceId = hexId();
const oldStartedAt = now - 200 * DAY_MS;

function summaryRow(overrides: Record<string, unknown>) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
    AnnotationIds: [],
    ...overrides,
  };
}

function spanRow(overrides: Record<string, unknown> & { TraceId: string }) {
  const start = (overrides.StartTime as Date | undefined) ?? new Date(now);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    SpanId: `${nanoid(16)}`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: start,
    EndTime: new Date(start.getTime() + 25),
    DurationMs: 25,
    SpanName: "agent.run",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 2,
    StatusMessage: "tool failed",
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: start,
    UpdatedAt: start,
    ...overrides,
  };
}

const yearPolicy: RetentionDaysProvider = { findRetentionDays: async () => [365] };

let ch: ClickHouseClient;
let repository: TraceLegacyReadClickHouseRepository;
const authorization = ownProof({ projectId: tenantId });

async function insert(table: string, values: Record<string, unknown>[]) {
  await ch.insert({
    table,
    values,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

describe.skipIf(!clickHouseConfigured)("TraceLegacyReadClickHouseRepository lookups by id", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    repository = TraceLegacyReadClickHouseRepository.create({
      resolveClickHouseClient: async () => ch,
      clickhouse: fencedOver(async () => ch),
    });
    await insert("stored_spans", [
      spanRow({ TraceId: unfoldedTraceId, SpanName: "root" }),
      spanRow({ TraceId: spannedTraceId, SpanId: knownSpanId }),
      spanRow({ TraceId: scenarioTraceId }),
      spanRow({ TraceId: epochTraceId }),
      spanRow({ TraceId: oldTraceId, StartTime: new Date(oldStartedAt) }),
    ]);
    await insert("trace_summaries", [
      summaryRow({ TraceId: spannedTraceId }),
      summaryRow({ TraceId: scenarioTraceId, Attributes: { "scenario.run_id": scenarioRunId } }),
      summaryRow({ TraceId: epochTraceId, OccurredAt: new Date(0) }),
      summaryRow({
        TraceId: oldTraceId,
        OccurredAt: new Date(oldStartedAt),
        CreatedAt: new Date(oldStartedAt),
        UpdatedAt: new Date(oldStartedAt),
      }),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of ["trace_summaries", "stored_spans"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  });

  describe("given a trace whose spans are stored but whose summary is not written", () => {
    /** @scenario A trace whose spans are stored but whose summary is not yet written still loads */
    it("builds the trace from its stored spans, marked still ingesting", async () => {
      const [row] = await repository.findTraceFromStoredSpans({
        authorization,
        projectId: tenantId,
        traceId: unfoldedTraceId,
        retentionDays: undefined,
      });

      expect(row?.summary.traceId).toBe(unfoldedTraceId);
      expect(row?.summary.traceName).toBe("root");
      expect(row?.summary.containsErrorStatus).toBe(true);
      expect(row?.summary.attributes[STILL_INGESTING_ATTRIBUTE]).toBe("true");
      expect(row?.spans).toHaveLength(1);
    });

    it("answers nothing for an id with no stored span", async () => {
      await expect(
        repository.findTraceFromStoredSpans({
          authorization,
          projectId: tenantId,
          traceId: hexId(),
          retentionDays: undefined,
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("given a span id", () => {
    /** @scenario A span id resolves to the trace that holds it */
    it("resolves to the trace that holds the span", async () => {
      await expect(
        repository.resolveTraceIdsBySpanId({
          authorization,
          projectId: tenantId,
          spanId: knownSpanId,
          occurredAt: window,
          limit: 1,
        }),
      ).resolves.toEqual([spannedTraceId]);
    });
  });

  describe("given a scenario run id", () => {
    /** @scenario A scenario run id resolves to the trace it produced */
    it("resolves to the trace carrying scenario.run_id", async () => {
      await expect(
        repository.resolveTraceIdsByScenarioRunId({
          authorization,
          projectId: tenantId,
          scenarioRunId,
          occurredAt: window,
          limit: 20,
        }),
      ).resolves.toEqual([scenarioTraceId]);
    });
  });

  describe("given a summary filed in the epoch partition", () => {
    /** @scenario A trace whose summary sits in the epoch partition still loads */
    it("reads the trace with its spans", async () => {
      const [row] = await repository.findTracesWithSpans({
        authorization,
        projectId: tenantId,
        traceIds: [epochTraceId],
        retentionDays: undefined,
      });

      expect(row?.summary.traceId).toBe(epochTraceId);
      expect(row?.spans).toHaveLength(1);
    });
  });

  describe("given a trace 200 days old in a project that keeps traces a year", () => {
    /** @scenario A trace older than the platform default retention still loads on a longer policy */
    it("reads the trace with its spans", async () => {
      const [row] = await repository.findTracesWithSpans({
        authorization,
        projectId: tenantId,
        traceIds: [oldTraceId],
        retentionDays: yearPolicy,
      });

      expect(row?.summary.traceId).toBe(oldTraceId);
      expect(row?.spans).toHaveLength(1);
    });

    it("builds it from its spans too while its summary is missing", async () => {
      const [row] = await repository.findTraceFromStoredSpans({
        authorization,
        projectId: tenantId,
        traceId: oldTraceId,
        retentionDays: yearPolicy,
      });

      expect(row?.spans).toHaveLength(1);
    });
  });
});

/**
 * Feature: specs/traces-v2/bulk-actions.feature
 *
 * `findExistingTraceIds` filters a bulk-action's candidate trace ids down to
 * the ones ClickHouse actually has, tenant-scoped. A bulk send (e.g. queueing
 * traces for annotation) must skip ids that resolve to no trace or belong to
 * another project, and must not round-trip to ClickHouse at all when there is
 * nothing to check.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support";

const tenantId = `test-texist-${nanoid()}`;
const otherTenantId = `test-texist-other-${nanoid()}`;
const liveTraceId = `trace-${nanoid()}`;
const otherTenantTraceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

const clickHouseUrl = testClickHouseUrl();
const integration = describe.skipIf(clickHouseUrl === null);

let ch: ClickHouseClient;
let repo: ClickHouseTraceExistenceRepository;

function makeRow(tenant: string, traceId: string, occurredAtMs: number) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(occurredAtMs),
    CreatedAt: new Date(occurredAtMs),
    UpdatedAt: new Date(occurredAtMs),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "input",
    ComputedOutput: "output",
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
    TraceName: "trace",
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(occurredAtMs),
    TopicId: null,
    SubTopicId: null,
  };
}

beforeAll(async () => {
  if (!clickHouseUrl) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  repo = ClickHouseTraceExistenceRepository.create({
    resolveClient: async () => ch,
  });

  await ch.insert({
    table: "trace_summaries",
    values: [
      makeRow(tenantId, liveTraceId, base),
      makeRow(otherTenantId, otherTenantTraceId, base),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId IN ({tenantId:String}, {otherTenantId:String})",
      query_params: { tenantId, otherTenantId },
    });
    await ch.close();
  }
});

integration("ClickHouseTraceExistenceRepository.findExistingTraceIds (integration)", () => {
  describe("when some of the candidates exist", () => {
    /** @scenario Sending traces for annotation skips ids that resolve to no trace */
    it("returns only the ids that resolve to a real trace", async () => {
      const result = await repo.findExistingTraceIds({
        projectId: tenantId,
        traceIds: [liveTraceId, "trace-does-not-exist"],
      });

      expect(result).toEqual([liveTraceId]);
    });
  });

  describe("when the candidate belongs to another project", () => {
    /** @scenario Sending traces for annotation skips ids that resolve to no trace */
    it("is excluded even though the id exists in ClickHouse", async () => {
      const result = await repo.findExistingTraceIds({
        projectId: tenantId,
        traceIds: [otherTenantTraceId],
      });

      expect(result).toEqual([]);
    });
  });

  describe("when there is nothing to check", () => {
    /** @scenario Blank ids are dropped before anything is queued */
    it("returns empty without querying ClickHouse", async () => {
      const result = await repo.findExistingTraceIds({
        projectId: tenantId,
        traceIds: [],
      });

      expect(result).toEqual([]);
    });
  });
});

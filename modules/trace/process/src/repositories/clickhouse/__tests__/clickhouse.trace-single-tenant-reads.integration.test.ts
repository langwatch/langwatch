/**
 * The built single-tenant reads of trace_summaries (ADR-202) over real ClickHouse, sent through
 * the client's tenant guard with their tenant setting: dedup by UpdatedAt, one tenant only.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceClusteringSampleRepository } from "../clickhouse.trace-clustering-sample.repository.ts";
import { ClickHouseTraceModelSpendRepository } from "../clickhouse.trace-model-spend.repository.ts";
import { TraceUsageCountClickHouseRepository } from "../trace-usage-count.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN = "langwatch.origin.kind";
const GROUP = "langwatch.user_id";
const tenantId = `test-single-reads-${nanoid()}`;
const otherTenantId = `test-single-reads-other-${nanoid()}`;
const now = Date.now();
const atMs = now - 60 * 60 * 1000;
const window = { startMs: now - DAY_MS, endMs: now + 60_000 };

let ch: ClickHouseClient;
let clustering: ClickHouseTraceClusteringSampleRepository;
let usage: TraceUsageCountClickHouseRepository;
let spend: ClickHouseTraceModelSpendRepository;

function row(args: {
  tenant?: string;
  traceId: string;
  updatedMs?: number;
  topicId: string | null;
  cost: number;
  models: string[];
  attributes: Record<string, string>;
  tokens: [number, number];
}) {
  const at = new Date(atMs);
  return {
    ProjectionId: `projn-${nanoid()}`,
    TenantId: args.tenant ?? tenantId,
    TraceId: args.traceId,
    Version: "v1",
    Attributes: args.attributes,
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: new Date(args.updatedMs ?? atMs),
    ComputedIOSchemaVersion: "",
    ComputedInput: `input of ${args.traceId}`,
    ComputedOutput: null,
    TotalDurationMs: 250,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: args.models,
    TotalCost: args.cost,
    TokensEstimated: false,
    TotalPromptTokenCount: args.tokens[0],
    TotalCompletionTokenCount: args.tokens[1],
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: args.traceId,
    RootSpanType: "",
    ContainsAi: true,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: at,
    TopicId: args.topicId,
    SubTopicId: null,
  };
}

describe.skipIf(!testClickHouseConfigured())(
  "trace's single-tenant built reads (real ClickHouse)",
  () => {
    beforeAll(async () => {
      ch = await startMigratedTraceClickHouse();
      const client = traceQueryClientFor(ch);
      clustering = ClickHouseTraceClusteringSampleRepository.create(client);
      usage = TraceUsageCountClickHouseRepository.create(client);
      spend = ClickHouseTraceModelSpendRepository.create(client);
      const traced = { [ORIGIN]: "ingestion_source", [GROUP]: "u1" };
      const insert = (values: ReturnType<typeof row>[]) =>
        ch.insert({
          table: "trace_summaries",
          format: "JSONEachRow",
          clickhouse_settings: { date_time_input_format: "best_effort" },
          values,
        });
      await insert([
        row({
          traceId: "t-a",
          topicId: "topic-1",
          cost: 1,
          models: ["gpt-5-mini"],
          attributes: traced,
          tokens: [60, 30],
        }),
      ]);
      // A later part re-projects t-a: its topic cleared, its cost raised; only this version counts.
      await insert([
        row({
          traceId: "t-a",
          updatedMs: atMs + 5_000,
          topicId: null,
          cost: 2,
          models: ["gpt-5-mini"],
          attributes: traced,
          tokens: [100, 50],
        }),
        row({
          traceId: "t-b",
          topicId: "topic-2",
          cost: 0.5,
          models: ["claude-sonnet-4"],
          attributes: { [ORIGIN]: "sdk", [GROUP]: "u2" },
          tokens: [10, 5],
        }),
        row({
          traceId: "t-c",
          topicId: null,
          cost: 0.25,
          models: ["claude-sonnet-4"],
          attributes: { [ORIGIN]: "sdk", [GROUP]: "u2" },
          tokens: [1, 1],
        }),
        row({
          tenant: otherTenantId,
          traceId: "t-o",
          topicId: "topic-9",
          cost: 9,
          models: ["gpt-5-mini"],
          attributes: { [ORIGIN]: "sdk", [GROUP]: "u2" },
          tokens: [900, 900],
        }),
      ]);
    }, 120_000);

    afterAll(async () => {
      if (!ch) return;
      await ch.exec({
        query: "ALTER TABLE trace_summaries DELETE WHERE TenantId IN ({a:String}, {b:String})",
        query_params: { a: tenantId, b: otherTenantId },
      });
    });

    describe("when topic clustering samples the tenant's traces", () => {
      it("counts each trace once at its latest version, a cleared topic unassigned", async () => {
        await expect(
          clustering.countTraces({
            tenantId,
            recentSinceMs: now - DAY_MS,
            windowStartMs: now - 30 * DAY_MS,
          }),
        ).resolves.toEqual({ total: 3, recent: 3, assigned: 1 });
      });

      it("pages the latest version of each trace and none of the other tenant's", async () => {
        const rows = await clustering.findPageRows({ tenantId, windowStartMs: now - 30 * DAY_MS });

        const byTrace = rows.toSorted((a, b) => a.traceId.localeCompare(b.traceId));
        expect(byTrace.map((each) => [each.traceId, each.topicId])).toEqual([
          ["t-a", null],
          ["t-b", "topic-2"],
          ["t-c", null],
        ]);
      });

      it("pages after the cursor, and nothing before the run's window end", async () => {
        const after = await clustering.findPageRows({
          tenantId,
          windowStartMs: now - 30 * DAY_MS,
          unassignedFrom: { topicIds: ["topic-2"], subtopicIds: ["subtopic-1"] },
          searchAfter: [atMs, "t-a"],
        });

        expect(after.map((each) => each.traceId).toSorted()).toEqual(["t-b", "t-c"]);
        expect(after.every((each) => each.occurredAtMs === atMs)).toBe(true);
        await expect(
          clustering.findPageRows({
            tenantId,
            windowStartMs: now - 30 * DAY_MS,
            windowEndMs: atMs,
          }),
        ).resolves.toEqual([]);
      });
    });

    describe("when usage counts read the tenant's traces", () => {
      it("counts the last day's distinct traces and lists first-seen ids in id order", async () => {
        await expect(usage.countTracesInLastDay({ tenantId })).resolves.toBe(3);
        await expect(
          usage.findTraceIdsFirstSeen({
            tenantId,
            fromMs: atMs - 1_000,
            toMs: now + 1_000,
            afterTraceId: "",
            limit: 10,
          }),
        ).resolves.toEqual(["t-a", "t-b", "t-c"]);
      });

      it("finds an attribute and counts its raw rows by another attribute", async () => {
        const attribute = { key: ORIGIN, value: "ingestion_source" };
        const sinceMs = now - DAY_MS;

        await expect(usage.hasTraceWithAttribute({ tenantId, sinceMs, attribute })).resolves.toBe(
          true,
        );
        await expect(
          usage.hasTraceWithAttribute({
            tenantId,
            sinceMs,
            attribute: { key: ORIGIN, value: "x" },
          }),
        ).resolves.toBe(false);
        await expect(
          usage.findTraceCountsByAttribute({
            tenantId,
            sinceMs,
            attribute: { key: ORIGIN, value: "sdk" },
            groupByKey: GROUP,
          }),
        ).resolves.toEqual([{ value: "u2", count: 2 }]);
      });
    });

    describe("when spend is read by model", () => {
      it("sums each trace's latest cost per model and in the summary", async () => {
        const models = await spend.findModelSpend({ tenantId, window, limit: 10 });
        expect(models.toSorted((a, b) => a.label.localeCompare(b.label))).toEqual([
          { label: "claude-sonnet-4", spentUsd: 0.75, billedUsd: 0.75, requests: 2 },
          { label: "gpt-5-mini", spentUsd: 2, billedUsd: 2, requests: 1 },
        ]);
        await expect(spend.getSpendSummary({ tenantId, window })).resolves.toEqual({
          totalCost: 2.75,
          billedCost: 2.75,
          requestCount: 3,
          promptTokens: 111,
          completionTokens: 56,
        });
      });

      it("counts requests per model and spend per day", async () => {
        const top = await spend.findTopModelsByRequests({ tenantId, window, limit: 10 });
        expect(top.toSorted((a, b) => a.model.localeCompare(b.model))).toEqual([
          { model: "claude-sonnet-4", requests: 2 },
          { model: "gpt-5-mini", requests: 1 },
        ]);
        await expect(spend.findDailySpend({ tenantId, window })).resolves.toEqual([
          { day: expect.any(String), spentUsd: 2.75, billedUsd: 2.75, requests: 3 },
        ]);
      });
    });
  },
);

/**
 * A full record's built summary, span and thread reads (ADR-202) over real ClickHouse, sent through
 * the client's tenant guard with their tenant setting: latest version only, one tenant only.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { TraceNotFoundError } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceFullRecordRowsRepository } from "../clickhouse.trace-full-record-rows.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const THREAD = "gen_ai.conversation.id";
const tenantId = `test-full-rows-${nanoid()}`;
const otherTenantId = `test-full-rows-other-${nanoid()}`;
const atMs = Date.now() - 60 * 60 * 1000;

let ch: ClickHouseClient;
let rows: ClickHouseTraceFullRecordRowsRepository;

function row(args: {
  tenant?: string;
  traceId: string;
  occurredMs: number;
  updatedMs: number;
  input: string;
  attributes: Record<string, string>;
}) {
  const at = new Date(args.occurredMs);
  return {
    ProjectionId: `projn-${nanoid()}`,
    TenantId: args.tenant ?? tenantId,
    TraceId: args.traceId,
    Version: "v1",
    Attributes: args.attributes,
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: new Date(args.updatedMs),
    ComputedIOSchemaVersion: "",
    ComputedInput: args.input,
    ComputedOutput: null,
    TotalDurationMs: 250,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: 0.5,
    TokensEstimated: false,
    TotalPromptTokenCount: 3,
    TotalCompletionTokenCount: 5,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: args.traceId,
    RootSpanType: "",
    ContainsAi: true,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: at,
    TopicId: null,
    SubTopicId: null,
  };
}

describe.skipIf(!testClickHouseConfigured())(
  "a full record's built summary and thread reads (real ClickHouse)",
  () => {
    beforeAll(async () => {
      ch = await startMigratedTraceClickHouse();
      rows = ClickHouseTraceFullRecordRowsRepository.create({ reader: traceQueryClientFor(ch) });
      const insert = (values: ReturnType<typeof row>[]) =>
        ch.insert({
          table: "trace_summaries",
          format: "JSONEachRow",
          clickhouse_settings: { date_time_input_format: "best_effort" },
          values,
        });
      const thread = { [THREAD]: "c-1" };
      await insert([
        row({
          traceId: "t-1",
          occurredMs: atMs,
          updatedMs: atMs,
          input: "old",
          attributes: thread,
        }),
        row({
          traceId: "t-2",
          occurredMs: atMs + 1_000,
          updatedMs: atMs,
          input: "two",
          attributes: thread,
        }),
        row({
          tenant: otherTenantId,
          traceId: "t-3",
          occurredMs: atMs - 1_000,
          updatedMs: atMs,
          input: "other",
          attributes: thread,
        }),
      ]);
      // A later part re-projects t-1; only this version is its summary.
      await insert([
        row({
          traceId: "t-1",
          occurredMs: atMs,
          updatedMs: atMs + 5_000,
          input: "new",
          attributes: thread,
        }),
      ]);
    });

    describe("when the trace's summary is read", () => {
      it("returns the latest version within the tenant", async () => {
        await expect(rows.getSummary({ tenantId, traceId: "t-1" })).resolves.toMatchObject({
          TraceId: "t-1",
          ComputedInput: "new",
          OccurredAtMs: atMs,
          UpdatedAtMs: atMs + 5_000,
          TotalCost: 0.5,
        });
      });

      it("finds no summary for another tenant's trace", async () => {
        await expect(rows.getSummary({ tenantId, traceId: "t-3" })).rejects.toEqual(
          new TraceNotFoundError("t-3"),
        );
      });
    });

    describe("when the thread's traces are read", () => {
      it("lists each of the tenant's traces once, oldest first", async () => {
        await expect(rows.findThreadTraces({ tenantId, threadId: "c-1" })).resolves.toEqual([
          { TraceId: "t-1", OccurredAtMs: atMs },
          { TraceId: "t-2", OccurredAtMs: atMs + 1_000 },
        ]);
      });
    });

    describe("when the trace's spans are read", () => {
      it("keeps each span's newest StartTime version within the tenant", async () => {
        const stored = (args: {
          tenant?: string;
          spanId: string;
          startMs: number;
          updatedMs: number;
          name: string;
        }) => ({
          TenantId: args.tenant ?? tenantId,
          TraceId: "t-1",
          SpanId: args.spanId,
          StartTime: new Date(args.startMs),
          EndTime: new Date(args.startMs + 10),
          DurationMs: 10,
          SpanName: args.name,
          CreatedAt: new Date(args.updatedMs),
          UpdatedAt: new Date(args.updatedMs),
        });
        const insert = (values: ReturnType<typeof stored>[]) =>
          ch.insert({
            table: "stored_spans",
            format: "JSONEachRow",
            clickhouse_settings: { date_time_input_format: "best_effort" },
            values,
          });
        await insert([
          stored({ spanId: "s-1", startMs: atMs + 100, updatedMs: atMs, name: "late start" }),
          stored({
            tenant: otherTenantId,
            spanId: "s-2",
            startMs: atMs,
            updatedMs: atMs,
            name: "other",
          }),
        ]);
        // Written later but started earlier: the engine replaces by StartTime, so this loses.
        await insert([
          stored({ spanId: "s-1", startMs: atMs, updatedMs: atMs + 9_000, name: "early start" }),
        ]);

        const spans = await rows.findSpans({ tenantId, traceId: "t-1", occurredAtMs: atMs });

        expect(
          spans.map(({ SpanId, SpanName, StartTimeMs }) => ({ SpanId, SpanName, StartTimeMs })),
        ).toEqual([{ SpanId: "s-1", SpanName: "late start", StartTimeMs: atMs + 100 }]);
      });
    });
  },
);

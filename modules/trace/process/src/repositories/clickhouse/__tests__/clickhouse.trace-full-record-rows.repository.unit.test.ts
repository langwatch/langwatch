/**
 * A full record's summary and thread rows are built reads within the record's own tenant
 * (ADR-202). Spec: modules/trace/specs/trace-read-service.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { TraceNotFoundError } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceFullRecordRowsRepository } from "../clickhouse.trace-full-record-rows.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const TENANT = "project-1";
const SUMMARY = {
  TraceId: "trace-1",
  Attributes: {},
  ComputedInput: null,
  ComputedOutput: null,
  ContainsErrorStatus: false,
  ErrorMessage: null,
  TimeToFirstTokenMs: null,
  TotalDurationMs: "10",
  TotalPromptTokenCount: null,
  TotalCompletionTokenCount: null,
  TotalCost: null,
  TokensEstimated: false,
  OccurredAtMs: "42",
  CreatedAtMs: "1",
  UpdatedAtMs: "2",
};

/** A reader answering the rows given, keeping each request it was sent. */
function repositoryOver(rows: unknown[]) {
  const requests: ReadRequest[] = [];
  const repository = ClickHouseTraceFullRecordRowsRepository.create({
    reader: clickHouseQueryClientDouble({
      async read(request: ReadRequest) {
        requests.push(request);
        return { rows };
      },
    }),
  });
  return { repository, requests };
}

/** How many times the statement binds `value` to a parameter. */
function bindings({
  request,
  value,
}: {
  request: ReadRequest | undefined;
  value: unknown;
}): number {
  const params = request?.statement.params ?? {};
  const names = Object.keys(params).filter((name) => params[name] === value);
  const sql = request?.statement.sql ?? "";
  return names.reduce((count, name) => count + sql.split(`{${name}:`).length - 1, 0);
}

function expectSingleTenantReader(
  request: ReadRequest | undefined,
  { table = "trace_summaries", version = "UpdatedAt" }: { table?: string; version?: string } = {},
) {
  expect(request?.table).toBe(table);
  expect(request?.statement).toMatchObject({
    kind: "tenant",
    identity: "reader",
    tenantId: TENANT,
    tenantIds: undefined,
    settings: { SQL_langwatch_tenant_ids: TENANT },
  });
  expect(request?.statement.sql).toContain("TenantId = {tenantId:String}");
  expect(request?.statement.sql).toContain(`max(${version})`);
}

const OCCURRED_MS = 1_700_000_000_000;
const PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

describe("ClickHouseTraceFullRecordRowsRepository", () => {
  describe("given a full record read for one project", () => {
    describe("when the trace's summary is read", () => {
      /** @scenario "A full trace record's summary and thread rows are read within the record's own tenant" */
      it("sends one reader statement over that project, bounded by the trace's id", async () => {
        const { repository, requests } = repositoryOver([SUMMARY]);

        await expect(
          repository.getSummary({ tenantId: TENANT, traceId: "trace-1", occurredAtMs: 42 }),
        ).resolves.toMatchObject({ TraceId: "trace-1", OccurredAtMs: 42 });

        expect(requests).toHaveLength(1);
        expectSingleTenantReader(requests[0]);
        expect(requests[0]?.statement.sql).toContain("{{idBound:trace_summaries.TraceId:");
        expect(requests[0]?.statement.sql).toMatch(/LIMIT 1\b/);
        expect(requests[0]?.idBound).toEqual({ occurredAtHint: 42, onMiss: "unbounded" });
      });

      it("throws the canonical missing error when the trace has no summary", async () => {
        const { repository } = repositoryOver([]);

        await expect(
          repository.getSummary({ tenantId: TENANT, traceId: "missing" }),
        ).rejects.toEqual(new TraceNotFoundError("missing"));
      });
    });

    describe("when the thread's traces are read", () => {
      /** @scenario "A full trace record's summary and thread rows are read within the record's own tenant" */
      it("repeats the conversation filter in the election, oldest first", async () => {
        const { repository, requests } = repositoryOver([{ TraceId: "first", OccurredAtMs: "10" }]);

        await expect(
          repository.findThreadTraces({ tenantId: TENANT, threadId: "thread-1" }),
        ).resolves.toEqual([{ TraceId: "first", OccurredAtMs: 10 }]);

        expect(requests).toHaveLength(1);
        expectSingleTenantReader(requests[0]);
        expect(bindings({ request: requests[0], value: "thread-1" })).toBe(2);
        expect(requests[0]?.statement.sql).toMatch(/ORDER BY OccurredAt ASC, TraceId ASC/);
        expect(requests[0]?.statement.sql).toMatch(/LIMIT 1000\b/);
      });
    });

    describe("when the trace's spans are read around its summary's occurrence", () => {
      /** @scenario "A full trace record's spans are elected on the engine's StartTime key within the record's own tenant" */
      it("elects on StartTime, repeating the trace and its occurrence window in the election", async () => {
        const { repository, requests } = repositoryOver([]);

        await repository.findSpans({
          tenantId: TENANT,
          traceId: "trace-1",
          occurredAtMs: OCCURRED_MS,
        });

        expect(requests).toHaveLength(1);
        expectSingleTenantReader(requests[0], { table: "stored_spans", version: "StartTime" });
        const sql = requests[0]?.statement.sql ?? "";
        expect(sql).toContain("(TenantId, TraceId, SpanId, StartTime) IN");
        expect(sql).not.toContain("max(UpdatedAt)");
        expect(bindings({ request: requests[0], value: "trace-1" })).toBe(2);
        expect(bindings({ request: requests[0], value: OCCURRED_MS - PARTITION_WINDOW_MS })).toBe(
          2,
        );
        expect(bindings({ request: requests[0], value: OCCURRED_MS + PARTITION_WINDOW_MS })).toBe(
          2,
        );
        expect(sql).toMatch(/ORDER BY StartTime ASC, SpanId ASC/);
        expect(sql).toMatch(/LIMIT 10000\b/);
        expect(sql).toMatch(/SETTINGS[^]*max_memory_usage/);
      });

      /** @scenario "A full trace record's spans are elected on the engine's StartTime key within the record's own tenant" */
      it("reads the trace's spans unwindowed when the summary names no occurrence", async () => {
        const { repository, requests } = repositoryOver([]);

        await repository.findSpans({ tenantId: TENANT, traceId: "trace-1", occurredAtMs: 0 });

        expectSingleTenantReader(requests[0], { table: "stored_spans", version: "StartTime" });
        expect(requests[0]?.statement.sql).not.toMatch(/StartTime [<>]=/);
      });
    });
  });
});

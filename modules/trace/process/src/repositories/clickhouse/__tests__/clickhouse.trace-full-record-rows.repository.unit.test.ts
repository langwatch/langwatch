/**
 * A full record's summary and thread rows are built reads within the record's own tenant
 * (ADR-202). Spec: modules/trace/specs/trace-read-service.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { TraceNotFoundError } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceFullRecordRowsRepository } from "../clickhouse.trace-full-record-rows.repository.ts";
import { TraceClickHouse } from "../clickhouse.trace-member-client.repository.ts";

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

/** The span read's raw client is never asked by these reads. */
class RefusingClients extends TraceClickHouse {
  resolve(): never {
    throw new Error("the summary and thread reads are built");
  }
}

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
    clients: new RefusingClients(),
  });
  return { repository, requests };
}

/** How many times the statement binds `value` to a parameter. */
function bindings({ request, value }: { request: ReadRequest | undefined; value: string }): number {
  const params = request?.statement.params ?? {};
  const names = Object.keys(params).filter((name) => params[name] === value);
  const sql = request?.statement.sql ?? "";
  return names.reduce((count, name) => count + sql.split(`{${name}:`).length - 1, 0);
}

function expectSingleTenantReader(request: ReadRequest | undefined) {
  expect(request?.table).toBe("trace_summaries");
  expect(request?.statement).toMatchObject({
    kind: "tenant",
    identity: "reader",
    tenantId: TENANT,
    tenantIds: undefined,
    settings: { SQL_langwatch_tenant_ids: TENANT },
  });
  expect(request?.statement.sql).toContain("TenantId = {tenantId:String}");
  expect(request?.statement.sql).toContain("max(UpdatedAt)");
}

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
  });
});

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import {
  TraceNotFoundError,
  traceRecordValueSchema,
  type NormalizedSpan,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { TraceFullIo } from "../../../features/read/services/trace-read-full-io.service.ts";
import { TracePayloadReaderRepository } from "../../trace-payload-reader.repository.ts";
import { ClickHouseTraceFullRecordRowsRepository } from "../clickhouse.trace-full-record-rows.repository.ts";
import { ClickHouseTraceFullRecordRepository } from "../trace-full-record.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

function outputText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

class Payloads extends TracePayloadReaderRepository {
  readonly calls: { tenantId: string; traceId: string }[] = [];

  constructor(private readonly value: string) {
    super();
  }

  async readFields(input: {
    tenantId: string;
    traceId: string;
    fields: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    this.calls.push({ tenantId: input.tenantId, traceId: input.traceId });
    return new Map(input.fields.map((field) => [field, this.value]));
  }
}

/** A blob read that fails. `readFields` throws; the recall answers each field with the error. */
class FailingPayloads extends TracePayloadReaderRepository {
  async readFields(): Promise<ReadonlyMap<string, string>> {
    throw new Error("blob unavailable");
  }
}

class FullIo implements TraceFullIo {
  recompute(spans: NormalizedSpan[]) {
    return {
      input: null,
      output: { type: "text", value: outputText(spans[0]?.spanAttributes["langwatch.output"]) },
    };
  }
}

class TypedFullIo implements TraceFullIo {
  recompute(spans: NormalizedSpan[]) {
    const value = spans[0]?.spanAttributes["langwatch.output"];
    const parsed = traceRecordValueSchema.safeParse(value);
    return {
      input: null,
      output: parsed.success ? { type: "json", value: parsed.data } : null,
    };
  }
}

const summary = (traceId: string) => ({
  TraceId: traceId,
  Attributes: { customer: "acme" },
  ComputedInput: "preview input",
  ComputedOutput: "preview output",
  ContainsErrorStatus: true,
  ErrorMessage: "trace error",
  TimeToFirstTokenMs: 2,
  TotalDurationMs: 10,
  TotalPromptTokenCount: 3,
  TotalCompletionTokenCount: 5,
  TotalCost: 0.2,
  TokensEstimated: false,
  OccurredAtMs: traceId === "later" ? 20 : 10,
  CreatedAtMs: 1,
  UpdatedAtMs: 2,
});

const span = (traceId: string) => ({
  SpanId: `${traceId}-span`,
  TraceId: traceId,
  TenantId: "tenant_a",
  ParentSpanId: null,
  ParentTraceId: null,
  ParentIsRemote: null,
  Sampled: 1,
  StartTimeMs: traceId === "later" ? "20" : "10",
  EndTimeMs: traceId === "later" ? "30" : "20",
  DurationMs: "10",
  SpanName: "model",
  SpanKind: 0,
  ResourceAttributes: {},
  SpanAttributes: {
    "langwatch.span.type": "llm",
    "langwatch.input": "preview input",
    "langwatch.output": "preview output",
    "gen_ai.usage.input_tokens": "3",
    "event.type": "score",
    "event.metrics.value": "1",
    "langwatch.reserved.eventref.langwatch.output": JSON.stringify({
      eventId: "event-1",
      field: "langwatch.output",
    }),
  },
  StatusCode: 2,
  StatusMessage: "span error",
  ScopeName: "",
  ScopeVersion: null,
  Events_Timestamp: ["15"],
  Events_Name: ["tool.called"],
  Events_Attributes: [{ tool: "search" }],
  Links_TraceId: [],
  Links_SpanId: [],
  Links_Attributes: [],
});

/** The built summary, span and thread reads, keyed by the trace or thread id each one binds. */
function readerFor(
  { missing = false, thread = false }: { missing?: boolean; thread?: boolean } = {},
  requests: ReadRequest[] = [],
) {
  return clickHouseQueryClientDouble({
    async read(request: ReadRequest) {
      requests.push(request);
      const bound = Object.values(request.statement.params ?? {});
      if (bound.includes("thread")) {
        const rows = thread
          ? [
              { TraceId: "later", OccurredAtMs: 20 },
              { TraceId: "first", OccurredAtMs: 10 },
            ]
          : [];
        return { rows };
      }
      const traceId = ["first", "later", "missing"].find((id) => bound.includes(id)) ?? "trace";
      if (request.table === "stored_spans") return { rows: [span(traceId)] };
      return { rows: missing ? [] : [summary(traceId)] };
    },
  });
}

function repositoryFor({
  reader = readerFor(),
  payloads,
  io = new FullIo(),
}: {
  reader?: Pick<ClickHouseQueryClient, "read">;
  payloads: TracePayloadReaderRepository;
  io?: TraceFullIo;
}) {
  const rows = ClickHouseTraceFullRecordRowsRepository.create({ reader });
  return ClickHouseTraceFullRecordRepository.create(rows, payloads, io);
}

const spanReadsOf = (requests: ReadRequest[]) =>
  requests.filter((request) => request.table === "stored_spans");

/** The tenant each built statement was sent under. */
function tenantsOf(requests: ReadRequest[]): unknown[] {
  return requests.map((request) => {
    const settings: Record<string, unknown> = request.statement.settings ?? {};
    return settings.SQL_langwatch_tenant_ids;
  });
}

describe("ClickHouseTraceFullRecordRepository", () => {
  it("returns tenant-scoped rich full records, recalls payloads, and recomputes IO", async () => {
    const requests: ReadRequest[] = [];
    const payloads = new Payloads("full output");
    const repository = repositoryFor({ reader: readerFor({}, requests), payloads });

    await expect(repository.get({ tenantId: "tenant_a", traceId: "trace" })).resolves.toMatchObject(
      {
        trace_id: "trace",
        project_id: "tenant_a",
        input: { value: "preview input" },
        output: { value: "full output" },
        error: { message: "trace error" },
        metrics: { total_cost: 0.2, prompt_tokens: 3 },
        spans: [
          expect.objectContaining({
            type: "llm",
            metrics: expect.objectContaining({ prompt_tokens: 3 }),
            error: { has_error: true, message: "span error", stacktrace: [] },
          }),
        ],
        events: expect.arrayContaining([expect.objectContaining({ event_type: "score" })]),
      },
    );
    expect(spanReadsOf(requests)).toHaveLength(1);
    expect(tenantsOf(requests)).toEqual(["tenant_a", "tenant_a"]);
    expect(payloads.calls).toEqual([
      expect.objectContaining({ tenantId: "tenant_a", traceId: "trace" }),
    ]);
  });

  it("throws the canonical missing error and never issues a cross-tenant payload read", async () => {
    const requests: ReadRequest[] = [];
    const payloads = new Payloads("unexpected");
    const repository = repositoryFor({
      reader: readerFor({ missing: true }, requests),
      payloads,
    });

    await expect(repository.get({ tenantId: "tenant_b", traceId: "missing" })).rejects.toEqual(
      new TraceNotFoundError("missing"),
    );
    expect(tenantsOf(requests)).toEqual(["tenant_b"]);
    expect(spanReadsOf(requests)).toEqual([]);
    expect(payloads.calls).toEqual([]);
  });

  it("uses stored_spans' StartTime ReplacingMergeTree election key", async () => {
    const requests: ReadRequest[] = [];
    const repository = repositoryFor({
      reader: readerFor({}, requests),
      payloads: new Payloads("unread"),
    });

    await repository.get({ tenantId: "tenant_a", traceId: "trace" });

    const spanReads = spanReadsOf(requests);
    const query = spanReads[0]?.statement.sql;
    expect(query).toContain("SpanId, StartTime) IN");
    expect(query).toContain("max(StartTime)");
    expect(query).not.toContain("SpanId, UpdatedAt");
    expect(spanReads).toHaveLength(1);
  });

  it("keeps the projection preview on blob failure and returns chronological thread records", async () => {
    const repository = repositoryFor({
      reader: readerFor({ thread: true }),
      payloads: new FailingPayloads(),
    });

    await expect(repository.get({ tenantId: "tenant_a", traceId: "trace" })).resolves.toMatchObject(
      {
        output: { value: "preview output" },
      },
    );
    await expect(
      repository.findThread({ tenantId: "tenant_a", threadId: "thread" }),
    ).resolves.toMatchObject([{ trace_id: "first" }, { trace_id: "later" }]);
  });

  it("deserializes claim-check JSON before canonical IO recomputation", async () => {
    const repository = repositoryFor({
      payloads: new Payloads('{"answer":"full"}'),
      io: new TypedFullIo(),
    });

    await expect(repository.get({ tenantId: "tenant_a", traceId: "trace" })).resolves.toMatchObject(
      {
        output: { type: "json", value: { answer: "full" } },
        spans: [expect.objectContaining({ output: { type: "json", value: { answer: "full" } } })],
      },
    );
  });
});

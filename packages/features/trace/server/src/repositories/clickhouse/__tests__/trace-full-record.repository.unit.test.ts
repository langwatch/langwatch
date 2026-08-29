import {
  TraceNotFoundError,
  traceRecordValueSchema,
  type NormalizedSpan,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceClickHousePort, type TraceClickHouseClient } from "../../../ports/clickhouse.port";
import { TracePayloadReaderPort } from "../../../ports/trace-payload-reader.port";
import { TraceFullIoPort } from "../../../ports/trace-full-io.port";
import { ClickHouseTraceFullRecordRepository } from "../trace-full-record.repository";

class ClientPort extends TraceClickHousePort {
  readonly tenants: string[] = [];

  constructor(private readonly client: TraceClickHouseClient) {
    super();
  }

  resolve(tenantId: string): Promise<TraceClickHouseClient> {
    this.tenants.push(tenantId);
    return Promise.resolve(this.client);
  }
}

class Payloads extends TracePayloadReaderPort {
  readonly calls: Array<{ tenantId: string; traceId: string }> = [];

  constructor(private readonly value: string | null) {
    super();
  }

  async tryRead(input: { tenantId: string; traceId: string }): Promise<string | null> {
    this.calls.push(input);
    return this.value;
  }
}

class FullIo extends TraceFullIoPort {
  recompute(spans: NormalizedSpan[]) {
    return {
      input: null,
      output: { type: "text", value: String(spans[0]?.spanAttributes["langwatch.output"] ?? "") },
    };
  }
}

class TypedFullIo extends TraceFullIoPort {
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
  StartTimeMs: traceId === "later" ? 20 : 10,
  EndTimeMs: traceId === "later" ? 30 : 20,
  SpanName: "model",
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
  Events_Timestamp: [15],
  Events_Name: ["tool.called"],
  Events_Attributes: [{ tool: "search" }],
});

function clientFor(
  { missing = false, thread = false }: { missing?: boolean; thread?: boolean } = {},
  queries: string[] = [],
) {
  return {
    query: async <_Row>(input: { query: string; query_params?: Record<string, unknown> }) => {
      queries.push(input.query);
      const traceId = String(input.query_params?.traceId ?? "trace");
      const rows = input.query.includes("Attributes['gen_ai.conversation.id']")
        ? thread
          ? [
              { TraceId: "later", OccurredAtMs: 20 },
              { TraceId: "first", OccurredAtMs: 10 },
            ]
          : []
        : input.query.includes("FROM trace_summaries")
          ? missing
            ? []
            : [summary(traceId)]
          : [span(traceId)];
      return { json: async <T>() => rows as T[] };
    },
  } satisfies TraceClickHouseClient;
}

describe("ClickHouseTraceFullRecordRepository", () => {
  it("returns tenant-scoped rich full records, recalls payloads, and recomputes IO", async () => {
    const port = new ClientPort(clientFor());
    const payloads = new Payloads("full output");
    const repository = ClickHouseTraceFullRecordRepository.create(port, payloads, new FullIo());

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
    expect(port.tenants).toEqual(["tenant_a"]);
    expect(payloads.calls).toEqual([
      expect.objectContaining({ tenantId: "tenant_a", traceId: "trace" }),
    ]);
  });

  it("throws the canonical missing error and never issues a cross-tenant payload read", async () => {
    const port = new ClientPort(clientFor({ missing: true }));
    const payloads = new Payloads("unexpected");
    const repository = ClickHouseTraceFullRecordRepository.create(port, payloads, new FullIo());

    await expect(repository.get({ tenantId: "tenant_b", traceId: "missing" })).rejects.toEqual(
      new TraceNotFoundError("missing"),
    );
    expect(port.tenants).toEqual(["tenant_b"]);
    expect(payloads.calls).toEqual([]);
  });

  it("uses stored_spans' StartTime ReplacingMergeTree election key", async () => {
    const queries: string[] = [];
    const repository = ClickHouseTraceFullRecordRepository.create(
      new ClientPort(clientFor({}, queries)),
      new Payloads(null),
      new FullIo(),
    );

    await repository.get({ tenantId: "tenant_a", traceId: "trace" });

    const query = queries.find((item) => item.includes("FROM stored_spans"));
    expect(query).toContain("SpanId, StartTime) IN");
    expect(query).toContain("max(StartTime)");
    expect(query).not.toContain("SpanId, UpdatedAt");
    expect(queries.filter((item) => item.includes("FROM stored_spans"))).toHaveLength(1);
  });

  it("keeps the projection preview on blob failure and returns chronological thread records", async () => {
    const port = new ClientPort(clientFor({ thread: true }));
    const repository = ClickHouseTraceFullRecordRepository.create(
      port,
      new Payloads(null),
      new FullIo(),
    );

    await expect(repository.get({ tenantId: "tenant_a", traceId: "trace" })).resolves.toMatchObject(
      {
        output: { value: "preview output" },
      },
    );
    await expect(
      repository.getThread({ tenantId: "tenant_a", threadId: "thread" }),
    ).resolves.toMatchObject([{ trace_id: "first" }, { trace_id: "later" }]);
  });

  it("deserializes claim-check JSON before canonical IO recomputation", async () => {
    const repository = ClickHouseTraceFullRecordRepository.create(
      new ClientPort(clientFor()),
      new Payloads('{"answer":"full"}'),
      new TypedFullIo(),
    );

    await expect(repository.get({ tenantId: "tenant_a", traceId: "trace" })).resolves.toMatchObject(
      {
        output: { type: "json", value: { answer: "full" } },
        spans: [expect.objectContaining({ output: { type: "json", value: { answer: "full" } } })],
      },
    );
  });
});

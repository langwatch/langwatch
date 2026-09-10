import { describe, expect, it, vi } from "vitest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { RecordCapturedSpanInput, TraceApi } from "@langwatch/trace-contract";
import { TraceApp, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceSpanIngest } from "../trace.infrastructure.ts";
import type { TraceLegacyRead } from "../trace.infrastructure.ts";

const input: RecordCapturedSpanInput = {
  projectId: "project_1",
  span: {
    trace_id: "0123456789abcdef0123456789abcdef",
    span_id: "0123456789abcdef",
    type: "span",
    name: "HTTP agent test",
    input: { type: "json", value: { body: "request" } },
    output: { type: "json", value: { status: 200 } },
    timestamps: { started_at: 1000, finished_at: 1250 },
  },
  customMetadata: { type: "agent_test", agent_id: "agent_1" },
  userId: "user_1",
  occurredAt: 1250,
};

function fixture() {
  const recordSpan = vi.fn<TraceSpanIngest["recordSpan"]>().mockResolvedValue(void 0);
  const app: TraceApi = TraceApp.create(
    createApiFixture<TraceAppDependencies>({
      spanIngest: createApiFixture<TraceSpanIngest>({ recordSpan }),
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
  return { app, recordSpan };
}

describe("TraceApi.recordCapturedSpan", () => {
  /** @scenario "A captured agent span uses the canonical trace ingestion command" */
  it("preserves IDs, time units, tenant and agent-test metadata in the OTLP command", async () => {
    const { app, recordSpan } = fixture();
    await app.recordCapturedSpan(input);
    expect(recordSpan).toHaveBeenCalledOnce();
    expect(recordSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "project_1",
        occurredAt: 1250,
        instrumentationScope: null,
        span: expect.objectContaining({
          traceId: input.span.trace_id,
          spanId: input.span.span_id,
          startTimeUnixNano: "1000000000",
          endTimeUnixNano: "1250000000",
        }),
      }),
    );
    const resource = recordSpan.mock.calls[0]?.[0].resource;
    expect(resource?.attributes).toEqual(
      expect.arrayContaining([
        { key: "langwatch.user.id", value: { stringValue: "user_1" } },
        { key: "langwatch.metadata.type", value: { stringValue: "agent_test" } },
        { key: "langwatch.metadata.agent_id", value: { stringValue: "agent_1" } },
      ]),
    );
  });

  it("rejects malformed captured spans before enqueueing", async () => {
    const { app, recordSpan } = fixture();
    await expect(app.recordCapturedSpan({ ...input, occurredAt: Number.NaN })).rejects.toThrow();
    expect(recordSpan).not.toHaveBeenCalled();
  });
});

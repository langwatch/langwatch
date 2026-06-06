import { describe, expect, it, vi } from "vitest";

import type {
  RecordLogCommandData,
  RecordSpanCommandData,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import { LogRequestCollectionService } from "../log-request-collection.service";

function makeService() {
  const recordLog = vi.fn<(data: RecordLogCommandData) => Promise<void>>(
    () => Promise.resolve(),
  );
  const recordSpan = vi.fn<(data: RecordSpanCommandData) => Promise<void>>(
    () => Promise.resolve(),
  );
  const service = new LogRequestCollectionService({ recordLog, recordSpan });
  return { service, recordLog, recordSpan };
}

describe("LogRequestCollectionService", () => {
  describe("when a LogRecord has neither traceId nor spanId", () => {
    /**
     * OTLP logs.proto v1.0.0 marks trace_id and span_id OPTIONAL on
     * LogRecord, and exporters that emit logs outside an active span
     * (Claude Code's OTEL_LOGS_EXPORTER without a traces exporter is the
     * canonical caller) leave both unset. The handler previously
     * silently dropped these — receiver returned 200 OK, on-call had no
     * signal, customer saw nothing arrive. The record is now stored
     * with empty TraceId/SpanId.
     */
    it("records the log with empty trace and span ids", async () => {
      const { service, recordLog } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test_tenant",
        logRequest: {
          resourceLogs: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "standalone-log-emitter" },
                  },
                ],
              },
              scopeLogs: [
                {
                  scope: { name: "test", version: "1.0.0" },
                  logRecords: [
                    {
                      timeUnixNano: "1700000000000000000",
                      body: { stringValue: "hello from a context-less log" },
                    },
                  ],
                },
              ],
            },
          ],
        },
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordLog).toHaveBeenCalledTimes(1);
      const [call] = recordLog.mock.calls;
      expect(call?.[0]).toMatchObject({
        tenantId: "project_test_tenant",
        traceId: "",
        spanId: "",
        body: "hello from a context-less log",
      });
    });
  });

  describe("when a LogRecord carries trace context", () => {
    it("forwards the normalized trace and span ids", async () => {
      const { service, recordLog } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test_tenant",
        logRequest: {
          resourceLogs: [
            {
              resource: { attributes: [] },
              scopeLogs: [
                {
                  scope: { name: "test", version: undefined },
                  logRecords: [
                    {
                      timeUnixNano: "1700000000000000000",
                      traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
                      spanId: "1122334455667788",
                      body: { stringValue: "in-span log" },
                    },
                  ],
                },
              ],
            },
          ],
        },
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordLog).toHaveBeenCalledTimes(1);
      const [call] = recordLog.mock.calls;
      expect(call?.[0]).toMatchObject({
        traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        spanId: "1122334455667788",
        body: "in-span log",
      });
    });
  });

  describe("claude_code log records — trace_id / span_id synthesis", () => {
    /**
     * Claude Code 2.1.x emits its events outside any active span, so the
     * OTLP exporter sends them with empty trace_id / span_id. Without the
     * synthesizer the fold projection skips the records and /me/traces
     * shows nothing. The synthesizer derives stable ids from (session.id,
     * prompt.id, event.name, event.sequence) at receive time.
     *
     * These cases exercise the synthesis through `user_prompt`, which stays
     * on the log path (only the model-call triplet is converted to spans —
     * see the conversion describe block below).
     */
    const claudeBatch = (records: Array<Record<string, any>>) => ({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "claude-code" } },
            ],
          },
          scopeLogs: [
            {
              scope: {
                name: "com.anthropic.claude_code.events",
                version: "2.1.162",
              },
              logRecords: records,
            },
          ],
        },
      ],
    });

    const userPrompt = (
      sessionId: string,
      promptId: string,
      seq: string,
      extra: Record<string, any>[] = [],
    ) => ({
      timeUnixNano: "1700000000000000000",
      body: { stringValue: "claude_code.user_prompt" },
      attributes: [
        { key: "event.name", value: { stringValue: "user_prompt" } },
        { key: "session.id", value: { stringValue: sessionId } },
        { key: "prompt.id", value: { stringValue: promptId } },
        { key: "event.sequence", value: { stringValue: seq } },
        ...extra,
      ],
    });

    it("synthesizes a stable traceId from session.id and a stable spanId per event", async () => {
      const { service, recordLog } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([
          userPrompt("sess_42", "p_1", "1", [
            { key: "prompt", value: { stringValue: "What is 2+2?" } },
          ]),
          {
            timeUnixNano: "1700000001000000000",
            body: { stringValue: "claude_code.hook_registered" },
            attributes: [
              { key: "event.name", value: { stringValue: "hook_registered" } },
              { key: "session.id", value: { stringValue: "sess_42" } },
              { key: "prompt.id", value: { stringValue: "p_1" } },
              { key: "event.sequence", value: { stringValue: "2" } },
            ],
          },
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordLog).toHaveBeenCalledTimes(2);
      const [c1, c2] = recordLog.mock.calls;
      const r1 = c1![0]!;
      const r2 = c2![0]!;
      expect(r1.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(r1.spanId).toMatch(/^[0-9a-f]{16}$/);
      // Same session ⇒ same trace, different events ⇒ different spans.
      expect(r2.traceId).toBe(r1.traceId);
      expect(r2.spanId).not.toBe(r1.spanId);
    });

    it("returns the SAME traceId across multiple turns of one session", async () => {
      const { service, recordLog } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([
          userPrompt("sess_multiturn", "p_1", "1"),
          userPrompt("sess_multiturn", "p_2", "3"),
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const traceIds = new Set(recordLog.mock.calls.map((c) => c[0]!.traceId));
      expect(traceIds.size).toBe(1);
    });

    it("returns DIFFERENT traceIds across different sessions", async () => {
      const { service, recordLog } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([
          userPrompt("sess_A", "p_1", "1"),
          userPrompt("sess_B", "p_1", "1"),
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const [c1, c2] = recordLog.mock.calls;
      expect(c1![0]!.traceId).not.toBe(c2![0]!.traceId);
    });

    /**
     * Idempotency guard: re-running the same OTLP batch (network
     * retry, receiver restart) must produce the same trace+span ids
     * so the stored_log_records ReplacingMergeTree dedups.
     */
    it("derives the same ids when re-ingesting the same record", async () => {
      const { service, recordLog } = makeService();
      const rec = userPrompt("s", "p", "1");
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([rec]),
        piiRedactionLevel: "ESSENTIAL",
      });
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([rec]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const [c1, c2] = recordLog.mock.calls;
      expect(c1![0]!.traceId).toBe(c2![0]!.traceId);
      expect(c1![0]!.spanId).toBe(c2![0]!.spanId);
    });

    it("does NOT synthesize ids for non-claude scopes even with empty wire ids", async () => {
      const { service, recordLog } = makeService();
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: {
          resourceLogs: [
            {
              resource: { attributes: [] },
              scopeLogs: [
                {
                  scope: {
                    name: "com.openai.codex.events",
                    version: "0.134",
                  },
                  logRecords: [
                    {
                      timeUnixNano: "1700000000000000000",
                      body: { stringValue: "codex event" },
                      attributes: [
                        {
                          key: "event.name",
                          value: { stringValue: "codex.api_request" },
                        },
                        { key: "session.id", value: { stringValue: "s" } },
                        { key: "prompt.id", value: { stringValue: "p" } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        piiRedactionLevel: "ESSENTIAL",
      });
      const r = recordLog.mock.calls[0]![0]!;
      expect(r.traceId).toBe("");
      expect(r.spanId).toBe("");
    });

    it("preserves the wire ids when the LogRecord already carries trace context", async () => {
      const { service, recordLog } = makeService();
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([
          {
            timeUnixNano: "1700000000000000000",
            traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
            spanId: "1122334455667788",
            body: { stringValue: "claude_code.user_prompt" },
            attributes: [
              { key: "event.name", value: { stringValue: "user_prompt" } },
              { key: "session.id", value: { stringValue: "s" } },
            ],
          },
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const r = recordLog.mock.calls[0]![0]!;
      expect(r.traceId).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
      expect(r.spanId).toBe("1122334455667788");
    });

    it("leaves ids empty when session.id is missing (no useful key to hash)", async () => {
      const { service, recordLog } = makeService();
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([
          {
            timeUnixNano: "1700000000000000000",
            body: { stringValue: "claude_code.user_prompt" },
            attributes: [
              { key: "event.name", value: { stringValue: "user_prompt" } },
              // no session.id
            ],
          },
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const r = recordLog.mock.calls[0]![0]!;
      expect(r.traceId).toBe("");
      expect(r.spanId).toBe("");
    });
  });

  describe("when a claude_code model-call event is converted to a span", () => {
    /**
     * The model-call triplet (api_request / api_request_body /
     * api_response_body) is trapped at ingest and converted into a single
     * gen_ai span; those records are NOT written to stored_log_records.
     * Every OTHER claude_code event stays on the log path. The detailed
     * join / shape / cost / orphan behaviour lives in the converter's own
     * unit test — these cases assert the service-level routing.
     */
    const scopeLogs = (records: Array<Record<string, any>>) => ({
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: {
                name: "com.anthropic.claude_code.events",
                version: "2.1.162",
              },
              logRecords: records,
            },
          ],
        },
      ],
    });

    const apiRequest = (seq: string, requestId: string) => ({
      timeUnixNano: "1700000001000000000",
      body: { stringValue: "claude_code.api_request" },
      attributes: [
        { key: "event.name", value: { stringValue: "api_request" } },
        { key: "session.id", value: { stringValue: "sess_conv" } },
        { key: "prompt.id", value: { stringValue: "p_1" } },
        { key: "event.sequence", value: { stringValue: seq } },
        { key: "model", value: { stringValue: "claude-opus-4-7" } },
        { key: "input_tokens", value: { stringValue: "120" } },
        { key: "output_tokens", value: { stringValue: "30" } },
        { key: "cost_usd", value: { stringValue: "0.0875" } },
        { key: "duration_ms", value: { stringValue: "2113" } },
        { key: "request_id", value: { stringValue: requestId } },
        { key: "query_source", value: { stringValue: "repl_main_thread" } },
      ],
    });

    const attrOf = (data: RecordSpanCommandData, key: string): unknown =>
      data.span.attributes.find((a) => a.key === key)?.value;

    it("drops the api_request from the log path and emits a gen_ai span instead", async () => {
      const { service, recordLog, recordSpan } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: scopeLogs([apiRequest("1", "req_a")]),
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordLog).not.toHaveBeenCalled();
      expect(recordSpan).toHaveBeenCalledTimes(1);
      const data = recordSpan.mock.calls[0]![0]!;
      expect(data.span.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(attrOf(data, "gen_ai.system")).toEqual({
        stringValue: "claude_code",
      });
      expect(attrOf(data, "gen_ai.request.model")).toEqual({
        stringValue: "claude-opus-4-7",
      });
      expect(attrOf(data, "gen_ai.usage.input_tokens")).toEqual({
        intValue: 120,
      });
      expect(attrOf(data, "langwatch.span.cost")).toEqual({
        doubleValue: 0.0875,
      });
      expect(attrOf(data, "langwatch.span.type")).toEqual({
        stringValue: "llm",
      });
    });

    it("keeps lifecycle events as logs while converting model-call events", async () => {
      const { service, recordLog, recordSpan } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: scopeLogs([
          {
            timeUnixNano: "1700000000000000000",
            body: { stringValue: "claude_code.user_prompt" },
            attributes: [
              { key: "event.name", value: { stringValue: "user_prompt" } },
              { key: "session.id", value: { stringValue: "sess_conv" } },
              { key: "prompt", value: { stringValue: "hello" } },
            ],
          },
          apiRequest("2", "req_b"),
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordLog).toHaveBeenCalledTimes(1);
      expect(recordLog.mock.calls[0]![0]!.attributes["event.name"]).toBe(
        "user_prompt",
      );
      expect(recordSpan).toHaveBeenCalledTimes(1);
    });

    it("is idempotent: the same api_request yields the same span id on re-ingest", async () => {
      const { service, recordSpan } = makeService();
      const batch = scopeLogs([apiRequest("1", "req_c")]);
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: batch,
        piiRedactionLevel: "ESSENTIAL",
      });
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: batch,
        piiRedactionLevel: "ESSENTIAL",
      });
      const [c1, c2] = recordSpan.mock.calls;
      expect(c1![0]!.span.spanId).toBe(c2![0]!.span.spanId);
      expect(c1![0]!.span.traceId).toBe(c2![0]!.span.traceId);
    });
  });

  describe("codex log records — trace_id / span_id synthesis", () => {
    /**
     * Codex emits its events (codex.user_prompt, codex.sse_event,
     * codex.conversation_starts) without trace context. The
     * synthesizer derives trace_id from conversation.id (groups
     * multi-turn into one trace) and span_id from
     * (conversation.id:event.name:event.sequence). Scope-name is
     * agnostic — codex's scope varies (`codex_exec` in 0.131,
     * `codex` in 0.13x) so the synth gates on the `codex.*`
     * event.name prefix instead.
     */
    const codexBatch = (
      records: Array<Record<string, any>>,
      scopeName = "codex_exec",
    ) => ({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "codex_exec" } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: scopeName, version: "0.134" },
              logRecords: records,
            },
          ],
        },
      ],
    });

    it("synthesizes trace_id from conversation.id + span_id per event", async () => {
      const { service, recordLog } = makeService();
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: codexBatch([
          {
            timeUnixNano: "1700000000000000000",
            body: { stringValue: "codex.user_prompt" },
            attributes: [
              { key: "event.name", value: { stringValue: "codex.user_prompt" } },
              { key: "conversation.id", value: { stringValue: "conv_42" } },
              { key: "event.sequence", value: { stringValue: "1" } },
              { key: "prompt", value: { stringValue: "Hello" } },
            ],
          },
          {
            timeUnixNano: "1700000001000000000",
            body: { stringValue: "codex.sse_event" },
            attributes: [
              { key: "event.name", value: { stringValue: "codex.sse_event" } },
              { key: "conversation.id", value: { stringValue: "conv_42" } },
              { key: "event.sequence", value: { stringValue: "2" } },
              { key: "model", value: { stringValue: "gpt-5.5" } },
            ],
          },
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });
      expect(recordLog).toHaveBeenCalledTimes(2);
      const [c1, c2] = recordLog.mock.calls;
      expect(c1![0]!.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(c1![0]!.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(c2![0]!.traceId).toBe(c1![0]!.traceId); // same conversation = same trace
      expect(c2![0]!.spanId).not.toBe(c1![0]!.spanId);
    });

    it("works with the bare `codex` scope name (0.13x)", async () => {
      const { service, recordLog } = makeService();
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: codexBatch(
          [
            {
              timeUnixNano: "1700000000000000000",
              body: { stringValue: "codex.sse_event" },
              attributes: [
                { key: "event.name", value: { stringValue: "codex.sse_event" } },
                { key: "conversation.id", value: { stringValue: "c" } },
                { key: "event.sequence", value: { stringValue: "1" } },
              ],
            },
          ],
          "codex",
        ),
        piiRedactionLevel: "ESSENTIAL",
      });
      const r = recordLog.mock.calls[0]![0]!;
      expect(r.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(r.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("leaves ids empty when conversation.id is missing", async () => {
      const { service, recordLog } = makeService();
      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: codexBatch([
          {
            timeUnixNano: "1700000000000000000",
            body: { stringValue: "codex.sse_event" },
            attributes: [
              { key: "event.name", value: { stringValue: "codex.sse_event" } },
              // no conversation.id
              { key: "event.sequence", value: { stringValue: "1" } },
            ],
          },
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const r = recordLog.mock.calls[0]![0]!;
      expect(r.traceId).toBe("");
      expect(r.spanId).toBe("");
    });
  });

  describe("when a LogRecord body is missing", () => {
    it("drops the record (no body, nothing meaningful to store)", async () => {
      const { service, recordLog } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test_tenant",
        logRequest: {
          resourceLogs: [
            {
              resource: { attributes: [] },
              scopeLogs: [
                {
                  scope: { name: "test", version: undefined },
                  logRecords: [
                    {
                      timeUnixNano: "1700000000000000000",
                      // No body — drop path still applies.
                    },
                  ],
                },
              ],
            },
          ],
        },
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(recordLog).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type {
  RecordLogCommandData,
  RecordSpanCommandData,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import { LogRequestCollectionService } from "../log-request-collection.service";

function makeService(opts: { withSpanRecorder?: boolean } = {}) {
  const recordLog = vi.fn<(data: RecordLogCommandData) => Promise<void>>(
    () => Promise.resolve(),
  );
  const recordSpan = vi.fn<(data: RecordSpanCommandData) => Promise<void>>(
    () => Promise.resolve(),
  );
  const service = new LogRequestCollectionService(
    opts.withSpanRecorder ? { recordLog, recordSpan } : { recordLog },
  );
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

  describe("claude_code log -> span synthesis", () => {
    /**
     * Claude Code 2.1.x dropped trace emission entirely; the cli.js
     * binary has no OTEL_TRACES_EXPORTER read path. Everything lands
     * in /v1/logs under the scope com.anthropic.claude_code.events
     * as standalone (no trace context) log records. The service
     * synthesizes one gen_ai span per (session.id, prompt.id) pair
     * so /me/traces shows claude code interactions like every other
     * Path B tool.
     */
    it("synthesizes a span when a user_prompt + api_request pair lands in one batch", async () => {
      const { service, recordLog, recordSpan } = makeService({
        withSpanRecorder: true,
      });

      await service.handleOtlpLogRequest({
        tenantId: "project_test_tenant",
        logRequest: {
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
                  logRecords: [
                    {
                      timeUnixNano: "1700000000000000000",
                      body: { stringValue: "claude_code.user_prompt" },
                      attributes: [
                        {
                          key: "event.name",
                          value: { stringValue: "user_prompt" },
                        },
                        { key: "session.id", value: { stringValue: "sess_42" } },
                        { key: "prompt.id", value: { stringValue: "p_1" } },
                        { key: "prompt", value: { stringValue: "What is 2+2?" } },
                      ],
                    },
                    {
                      timeUnixNano: "1700000001000000000",
                      body: { stringValue: "claude_code.api_request" },
                      attributes: [
                        {
                          key: "event.name",
                          value: { stringValue: "api_request" },
                        },
                        { key: "session.id", value: { stringValue: "sess_42" } },
                        { key: "prompt.id", value: { stringValue: "p_1" } },
                        { key: "model", value: { stringValue: "claude-opus-4-7" } },
                        { key: "input_tokens", value: { intValue: "13" } },
                        { key: "output_tokens", value: { intValue: "27" } },
                        { key: "cost_usd", value: { doubleValue: 0.001234 } },
                        { key: "duration_ms", value: { intValue: "1500" } },
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

      expect(recordLog).toHaveBeenCalledTimes(2);
      expect(recordSpan).toHaveBeenCalledTimes(1);
      const span = recordSpan.mock.calls[0]![0]!.span;
      expect(span.name).toBe("claude_code.api_request");
      expect(
        span.attributes.find((a) => a.key === "gen_ai.request.model")?.value,
      ).toMatchObject({ stringValue: "claude-opus-4-7" });
    });

    it("does not synthesize spans when recordSpan dep is omitted", async () => {
      const { service, recordLog, recordSpan } = makeService(); // no span recorder

      await service.handleOtlpLogRequest({
        tenantId: "project_test_tenant",
        logRequest: {
          resourceLogs: [
            {
              resource: { attributes: [] },
              scopeLogs: [
                {
                  scope: {
                    name: "com.anthropic.claude_code.events",
                    version: "2.1.162",
                  },
                  logRecords: [
                    {
                      timeUnixNano: "1700000000000000000",
                      body: { stringValue: "claude_code.api_request" },
                      attributes: [
                        {
                          key: "event.name",
                          value: { stringValue: "api_request" },
                        },
                        { key: "session.id", value: { stringValue: "s" } },
                        { key: "prompt.id", value: { stringValue: "p" } },
                        { key: "model", value: { stringValue: "claude-opus-4-7" } },
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

      expect(recordLog).toHaveBeenCalledTimes(1);
      expect(recordSpan).not.toHaveBeenCalled();
    });

    it("does NOT synthesize for non-claude scopes even when recordSpan is wired", async () => {
      const { service, recordSpan } = makeService({ withSpanRecorder: true });

      await service.handleOtlpLogRequest({
        tenantId: "project_test_tenant",
        logRequest: {
          resourceLogs: [
            {
              resource: { attributes: [] },
              scopeLogs: [
                {
                  scope: { name: "com.openai.codex.events", version: "0.134" },
                  logRecords: [
                    {
                      timeUnixNano: "1700000000000000000",
                      body: { stringValue: "codex.api_request" },
                      attributes: [
                        {
                          key: "event.name",
                          value: { stringValue: "api_request" },
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

      expect(recordSpan).not.toHaveBeenCalled();
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

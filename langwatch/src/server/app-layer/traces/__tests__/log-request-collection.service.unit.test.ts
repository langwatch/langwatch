import { describe, expect, it, vi } from "vitest";

import type { RecordLogCommandData } from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import { LogRequestCollectionService } from "../log-request-collection.service";

function makeService() {
  const recordLog = vi.fn<(data: RecordLogCommandData) => Promise<void>>(
    () => Promise.resolve(),
  );
  const service = new LogRequestCollectionService({ recordLog });
  return { service, recordLog };
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
     * Claude Code 2.1.x emits its api_request / user_prompt events
     * outside any active span, so the OTLP exporter sends them with
     * empty trace_id / span_id. Without the synthesizer the fold
     * projection skips the records and /me/traces shows nothing.
     *
     * The synthesizer derives stable ids from (session.id,
     * prompt.id, event.name, event.sequence) at receive time so the
     * existing fold + extractIOFromLogRecord operate unchanged.
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

    it("synthesizes a stable traceId from session.id and a stable spanId per event", async () => {
      const { service, recordLog } = makeService();

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([
          {
            timeUnixNano: "1700000000000000000",
            body: { stringValue: "claude_code.user_prompt" },
            attributes: [
              { key: "event.name", value: { stringValue: "user_prompt" } },
              { key: "session.id", value: { stringValue: "sess_42" } },
              { key: "prompt.id", value: { stringValue: "p_1" } },
              { key: "event.sequence", value: { stringValue: "1" } },
              { key: "prompt", value: { stringValue: "What is 2+2?" } },
            ],
          },
          {
            timeUnixNano: "1700000001000000000",
            body: { stringValue: "claude_code.api_request" },
            attributes: [
              { key: "event.name", value: { stringValue: "api_request" } },
              { key: "session.id", value: { stringValue: "sess_42" } },
              { key: "prompt.id", value: { stringValue: "p_1" } },
              { key: "event.sequence", value: { stringValue: "2" } },
              { key: "model", value: { stringValue: "claude-opus-4-7" } },
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
      const mkRec = (promptId: string, seq: string, evName: string) => ({
        timeUnixNano: "1700000000000000000",
        body: { stringValue: `claude_code.${evName}` },
        attributes: [
          { key: "event.name", value: { stringValue: evName } },
          { key: "session.id", value: { stringValue: "sess_multiturn" } },
          { key: "prompt.id", value: { stringValue: promptId } },
          { key: "event.sequence", value: { stringValue: seq } },
        ],
      });

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([
          mkRec("p_1", "1", "user_prompt"),
          mkRec("p_1", "2", "api_request"),
          mkRec("p_2", "3", "user_prompt"),
          mkRec("p_2", "4", "api_request"),
        ]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const traceIds = new Set(recordLog.mock.calls.map((c) => c[0]!.traceId));
      expect(traceIds.size).toBe(1);
    });

    it("returns DIFFERENT traceIds across different sessions", async () => {
      const { service, recordLog } = makeService();
      const mkRec = (sessionId: string) => ({
        timeUnixNano: "1700000000000000000",
        body: { stringValue: "claude_code.api_request" },
        attributes: [
          { key: "event.name", value: { stringValue: "api_request" } },
          { key: "session.id", value: { stringValue: sessionId } },
          { key: "prompt.id", value: { stringValue: "p_1" } },
          { key: "event.sequence", value: { stringValue: "1" } },
        ],
      });

      await service.handleOtlpLogRequest({
        tenantId: "project_test",
        logRequest: claudeBatch([mkRec("sess_A"), mkRec("sess_B")]),
        piiRedactionLevel: "ESSENTIAL",
      });
      const [c1, c2] = recordLog.mock.calls;
      expect(c1![0]!.traceId).not.toBe(c2![0]!.traceId);
    });

    /**
     * Idempotency guard: re-running the same OTLP batch (network
     * retry, receiver restart) must produce the same trace+span ids
     * so the stored_log_records ReplacingMergeTree dedups instead
     * of double-counting cost.
     */
    it("derives the same ids when re-ingesting the same record", async () => {
      const { service, recordLog } = makeService();
      const rec = {
        timeUnixNano: "1700000000000000000",
        body: { stringValue: "claude_code.api_request" },
        attributes: [
          { key: "event.name", value: { stringValue: "api_request" } },
          { key: "session.id", value: { stringValue: "s" } },
          { key: "prompt.id", value: { stringValue: "p" } },
          { key: "event.sequence", value: { stringValue: "1" } },
        ],
      };
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
            body: { stringValue: "claude_code.api_request" },
            attributes: [
              { key: "event.name", value: { stringValue: "api_request" } },
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
            body: { stringValue: "claude_code.api_request" },
            attributes: [
              { key: "event.name", value: { stringValue: "api_request" } },
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

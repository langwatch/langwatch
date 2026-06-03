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

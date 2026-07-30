import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecord } from "~/server/event-sourcing/log-processing/schema";
import type { LogContribution } from "~/server/event-sourcing/trace-processing/schema";
import {
  type LogRequestCollectionResult,
  LogRequestCollectionService,
} from "../log-request-collection.service";

/** Narrows the result union so a test can assert on the collected counters. */
function expectCollected(
  result: LogRequestCollectionResult,
): Extract<LogRequestCollectionResult, { outcome: "collected" }> {
  if (result.outcome !== "collected") {
    throw new Error(`expected a collected result, got "${result.outcome}"`);
  }
  return result;
}

function makeService(args?: {
  storageFails?: boolean;
  contributionFails?: boolean;
}) {
  const records: CanonicalLogRecord[] = [];
  const contributions: LogContribution[] = [];
  const recordLogRecords = vi.fn(async (batch: CanonicalLogRecord[]) => {
    if (args?.storageFails) throw new Error("storage unavailable");
    records.push(...batch);
  });
  const recordLogContributions = vi.fn(async (batch: LogContribution[]) => {
    if (args?.contributionFails) throw new Error("trace unavailable");
    contributions.push(...batch);
  });
  const service = new LogRequestCollectionService({
    recordLogRecords,
    recordLogContributions,
    piiRedactionService: { redactLog: async () => undefined },
  });
  return {
    service,
    records,
    contributions,
    recordLogRecords,
    recordLogContributions,
  };
}

const args = {
  tenantId: "project_test",
  organizationId: "organization_test",
  piiRedactionLevel: "DISABLED",
};

function logRequest() {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: "langwatch.cost.non_billable",
              value: { stringValue: "true" },
            },
          ],
        },
        scopeLogs: [
          {
            scope: { name: "com.anthropic.claude_code.events" },
            logRecords: [
              {
                timeUnixNano: "1700000000000000000",
                severityNumber: 9,
                severityText: "INFO",
                body: { stringValue: "claude_code.user_prompt" },
                attributes: [
                  { key: "event.name", value: { stringValue: "user_prompt" } },
                  { key: "event.sequence", value: { stringValue: "1" } },
                  { key: "session.id", value: { stringValue: "session-1" } },
                  { key: "prompt.id", value: { stringValue: "prompt-1" } },
                  { key: "prompt", value: { stringValue: "hello" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as any;
}

describe("LogRequestCollectionService", () => {
  it("stores the canonical record then emits a compact trace contribution", async () => {
    const { service, records, contributions } = makeService();
    const result = await service.handleOtlpLogRequest({
      ...args,
      logRequest: logRequest(),
    });

    expect(result).toEqual({
      outcome: "collected",
      acceptedLogRecords: 1,
      rejectedLogRecords: 0,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      organizationId: args.organizationId,
      correlationSource: "claude_synthesized",
      providerKind: "claude_code",
    });
    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      recordId: records[0]!.recordId,
      traceId: records[0]!.correlationTraceId,
      spanId: records[0]!.correlationSpanId,
      body: "claude_code.user_prompt",
      scopeName: "com.anthropic.claude_code.events",
    });
    expect(contributions[0]!.attributes).toMatchObject({ prompt: "hello" });
  });

  it("keeps a correlated log accepted when its trace contribution cannot be queued", async () => {
    const { service } = makeService({ contributionFails: true });

    const result = await service.handleOtlpLogRequest({
      ...args,
      logRequest: logRequest(),
    });

    // The canonical record is already durably enqueued and is the source of
    // truth; the contribution is best-effort correlation, as in the metric
    // pipeline. Rejecting here would tell the sender to discard a log we
    // have in fact accepted, and a retry would re-ingest it.
    const collected = expectCollected(result);
    expect(collected.acceptedLogRecords).toBe(1);
    expect(collected.rejectedLogRecords).toBe(0);
  });

  describe("when the canonical batch cannot be persisted", () => {
    it("reports the batch as unavailable rather than rejected", async () => {
      const { service, recordLogContributions } = makeService({
        storageFails: true,
      });

      const result = await service.handleOtlpLogRequest({
        ...args,
        logRequest: logRequest(),
      });

      // A persistence failure is ours, so the records must stay retryable. If
      // this ever reports `collected` with a non-zero `rejectedLogRecords`,
      // the route answers 200 + partialSuccess and every collector in the
      // fleet drops the batch it could have re-sent.
      expect(result.outcome).toBe("unavailable");
      expect(result).not.toHaveProperty("rejectedLogRecords");
      expect(recordLogContributions).not.toHaveBeenCalled();
    });

    it("does not echo storage internals back to the sender", async () => {
      const { service } = makeService({ storageFails: true });

      const result = await service.handleOtlpLogRequest({
        ...args,
        logRequest: logRequest(),
      });

      expect(result.errorMessage).toBe("failed to record log record");
      expect(result.errorMessage).not.toContain("storage unavailable");
    });
  });

  it("enqueues each accepted request as one canonical and one contribution batch", async () => {
    const request = logRequest();
    request.resourceLogs[0].scopeLogs[0].logRecords.push(
      structuredClone(request.resourceLogs[0].scopeLogs[0].logRecords[0]),
    );
    const { service, recordLogRecords, recordLogContributions } = makeService();

    await service.handleOtlpLogRequest({ ...args, logRequest: request });

    expect(recordLogRecords).toHaveBeenCalledTimes(1);
    expect(recordLogRecords.mock.calls[0]![0]).toHaveLength(2);
    expect(recordLogContributions).toHaveBeenCalledTimes(1);
    expect(recordLogContributions.mock.calls[0]![0]).toHaveLength(2);
  });
});

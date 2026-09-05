import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import type { CanonicalLogRecordRepository } from "../../repositories/canonical-log-record.repository";
import { CanonicalLogAdapter, LogService } from "@langwatch/log-server/testing";
import type { LogTraceContribution } from "@langwatch/trace-contract";
import { TraceCanonicalisationService } from "@langwatch/trace-server/testing";
import {
  type LogRequestCollectionResult,
  LogRequestCollectionService,
} from "../log-request-collection.service";
import type { LogRedactionPort } from "../../ports/log-redaction.port";
import { LogTraceIoPort, type LogTraceIo } from "../../ports/log-trace-io.port";
import type { LogRecordReceivedEventData } from "@langwatch/trace-contract";

/**
 * This suite drives the COLLECTION, which prepares records and hands them to
 * the recorder it was given; nothing here reads a record back, so the store
 * refuses rather than pretending to hold one.
 */
const unreadableLogRecords = {
  ensureLogRecord: async () => undefined,
  ensureLogRecords: async () => undefined,
  getLogsByTraceId: async () => {
    throw new Error("this suite reads no log back");
  },
} as unknown as CanonicalLogRecordRepository;

/** Every request below asks for no redaction, so the port never rewrites. */
const disabledRedaction: LogRedactionPort = { redactLog: async () => {} };

/** Trace's byte budget stands in for `IO_PREVIEW_BYTES`; the flag is what matters. */
const PREVIEW_BYTES = 64;

/**
 * Stands in for Trace's log reader: input is the record's `prompt` attribute,
 * clamped to whole UTF-8 characters within the budget above.
 */
class PromptTraceIo extends LogTraceIoPort {
  extractIo(data: LogRecordReceivedEventData): LogTraceIo {
    const prompt = data.attributes.prompt;
    return { input: typeof prompt === "string" ? prompt : null, output: null };
  }

  preview(value: string): string {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.byteLength <= PREVIEW_BYTES) return value;
    return new TextDecoder("utf-8").decode(bytes.subarray(0, PREVIEW_BYTES)).replace(/\uFFFD$/, "");
  }
}

/** Narrows the result union so a test can assert on the collected counters. */
function expectCollected(
  result: LogRequestCollectionResult,
): Extract<LogRequestCollectionResult, { outcome: "collected" }> {
  if (result.outcome !== "collected") {
    throw new Error(`expected a collected result, got "${result.outcome}"`);
  }
  return result;
}

function makeService(args?: { storageFails?: boolean; contributionFails?: boolean }) {
  const records: CanonicalLogRecord[] = [];
  const contributions: LogTraceContribution[] = [];
  const recordLogRecords = vi.fn(async (batch: CanonicalLogRecord[]) => {
    if (args?.storageFails) throw new Error("storage unavailable");
    records.push(...batch);
  });
  const recordLogContributions = vi.fn(async (batch: LogTraceContribution[]) => {
    if (args?.contributionFails) throw new Error("trace unavailable");
    contributions.push(...batch);
  });
  const logs = LogService.create({
    preparation: CanonicalLogAdapter.create({
      redaction: disabledRedaction,
    }),
    repository: unreadableLogRecords,
  });
  const service = LogRequestCollectionService.create({
    logs,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    traceIo: new PromptTraceIo(),
    recordLogRecords,
    recordLogContributions,
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

/** A plain OTLP log: no wire ids, and no provider the pipeline can synthesize from. */
function uncorrelatedLogRequest() {
  return {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            scope: { name: "com.example.service" },
            logRecords: [
              {
                timeUnixNano: "1700000000000000000",
                severityNumber: 9,
                severityText: "INFO",
                body: { stringValue: "a log with nothing to correlate" },
                attributes: [],
              },
            ],
          },
        ],
      },
    ],
  } as any;
}

describe("LogRequestCollectionService", () => {
  describe("given a canonical log carrying no valid correlation ids", () => {
    describe("when the pipeline processes it", () => {
      /** @scenario "An uncorrelated log does not call Trace" */
      it("stores the record and asks Trace for nothing", async () => {
        const { service, records, recordLogRecords, recordLogContributions } = makeService();

        const result = await service.handleOtlpLogRequest({
          ...args,
          logRequest: uncorrelatedLogRequest(),
        });

        expect(result).toEqual({
          outcome: "collected",
          acceptedLogRecords: 1,
          rejectedLogRecords: 0,
        });
        expect(recordLogRecords).toHaveBeenCalledTimes(1);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ correlationSource: "none" });
        expect(recordLogContributions).not.toHaveBeenCalled();
      });
    });
  });

  /** @scenario "A correlated log contributes to Trace without sharing ownership" */
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
      input: "hello",
      nonBillable: true,
      occurredAt: records[0]!.acceptedAt,
    });
    expect(JSON.stringify(contributions[0]).length).toBeLessThan(records[0]!.canonicalSizeBytes);
  });

  /** @scenario "Trace contribution is best effort" */
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

  it("bounds duplicated trace I/O while retaining the full canonical log", async () => {
    const request = logRequest();
    const prompt = "é".repeat(PREVIEW_BYTES);
    request.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(
      (attribute: { key: string }) => attribute.key === "prompt",
    ).value.stringValue = prompt;
    const { service, records, contributions } = makeService();

    await service.handleOtlpLogRequest({ ...args, logRequest: request });

    expect(records[0]!.canonicalPayload).toContain(prompt);
    expect(Buffer.byteLength(contributions[0]!.input!, "utf8")).toBeLessThanOrEqual(PREVIEW_BYTES);
    expect(contributions[0]!.liftedAttributes["langwatch.reserved.log_io_truncated"]).toBe(true);
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

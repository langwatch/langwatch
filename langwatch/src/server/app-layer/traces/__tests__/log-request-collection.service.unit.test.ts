import { describe, expect, it, vi } from "vitest";
import type {
  CanonicalLogRecord,
  LogTraceContribution,
} from "~/server/event-sourcing/pipelines/log-processing/schemas/logRecord";
import { IO_PREVIEW_BYTES } from "../lean-for-projection";
import { LogRequestCollectionService } from "../log-request-collection.service";

function makeService(args?: {
  storageFails?: boolean;
  contributionFails?: boolean;
}) {
  const records: CanonicalLogRecord[] = [];
  const contributions: LogTraceContribution[] = [];
  const recordLogRecords = vi.fn(async (batch: CanonicalLogRecord[]) => {
    if (args?.storageFails) throw new Error("storage unavailable");
    records.push(...batch);
  });
  const recordLogContributions = vi.fn(
    async (batch: LogTraceContribution[]) => {
      if (args?.contributionFails) throw new Error("trace unavailable");
      contributions.push(...batch);
    },
  );
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

    expect(result).toEqual({ acceptedLogRecords: 1, rejectedLogRecords: 0 });
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
    expect(JSON.stringify(contributions[0]).length).toBeLessThan(
      records[0]!.canonicalSizeBytes,
    );
  });

  it("rejects a correlated log when its trace contribution cannot be queued", async () => {
    const { service } = makeService({ contributionFails: true });
    const result = await service.handleOtlpLogRequest({
      ...args,
      logRequest: logRequest(),
    });
    expect(result.acceptedLogRecords).toBe(0);
    expect(result.rejectedLogRecords).toBe(1);
  });

  it("bounds duplicated trace I/O while retaining the full canonical log", async () => {
    const request = logRequest();
    const prompt = "é".repeat(IO_PREVIEW_BYTES);
    request.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(
      (attribute: { key: string }) => attribute.key === "prompt",
    ).value.stringValue = prompt;
    const { service, records, contributions } = makeService();

    await service.handleOtlpLogRequest({ ...args, logRequest: request });

    expect(records[0]!.canonicalPayload).toContain(prompt);
    expect(
      Buffer.byteLength(contributions[0]!.input!, "utf8"),
    ).toBeLessThanOrEqual(IO_PREVIEW_BYTES + 3);
    expect(
      contributions[0]!.liftedAttributes["langwatch.reserved.log_io_truncated"],
    ).toBe(true);
  });

  it("reports canonical command failures as partial rejection", async () => {
    const { service, recordLogContributions } = makeService({
      storageFails: true,
    });
    const result = await service.handleOtlpLogRequest({
      ...args,
      logRequest: logRequest(),
    });
    expect(result.acceptedLogRecords).toBe(0);
    expect(result.rejectedLogRecords).toBe(1);
    expect(result.errorMessage).toContain("storage unavailable");
    expect(recordLogContributions).not.toHaveBeenCalled();
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

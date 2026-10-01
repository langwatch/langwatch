import { createApiFixture } from "@langwatch/api-fixture";
import type {
  CanonicalLogRecord,
  LogApi,
  PreparedCanonicalLogRecord,
} from "@langwatch/log-contract";
import type { LogTraceContribution, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { LogRequestCollectionService } from "../log-request-collection.service.ts";
import { preparedLog } from "./log-request-collection.fixture.ts";

function collect(options: {
  accepted: PreparedCanonicalLogRecord[];
  recordFails?: boolean;
  contributionFails?: boolean;
  truncated?: boolean;
}) {
  const recorded: CanonicalLogRecord[][] = [];
  const contributed: LogTraceContribution[][] = [];
  const logs = createApiFixture<LogApi>({
    prepareCanonicalLogRecords: async () => ({
      accepted: options.accepted,
      rejectedLogRecords: 1,
      errors: ["log record 2: missing body"],
    }),
  });
  const traces = createApiFixture<TraceApi>({
    canonicalizeLogRecord: () => ({
      attributes: { "gen_ai.system": "spring-ai" },
      appliedRules: [],
    }),
    extractLogRecordIO: () => ({
      input: "prompt",
      output: null,
      truncated: options.truncated ?? false,
    }),
    recordLogContributions: async (data) => {
      if (options.contributionFails) throw new Error("trace queue down");
      contributed.push([...data]);
    },
  });
  const service = LogRequestCollectionService.create({
    traces,
    logs,
    recordLogRecords: async (records) => {
      if (options.recordFails) throw new Error("clickhouse-internal.example:9000 refused");
      recorded.push(records);
    },
  });
  const result = service.handleOtlpLogRequest({
    tenantId: "project-1",
    organizationId: "organization-1",
    logRequest: { resourceLogs: [] },
    piiRedactionLevel: "DISABLED",
  });
  return { result, recorded, contributed };
}

describe("LogRequestCollectionService", () => {
  describe("given a canonical log carrying no valid correlation ids", () => {
    /** @scenario "An uncorrelated log does not call Trace" */
    it("records the log and sends Trace nothing", async () => {
      const { result, recorded, contributed } = collect({
        accepted: [preparedLog({ correlationSource: "none" })],
      });

      await expect(result).resolves.toMatchObject({ outcome: "collected", acceptedLogRecords: 1 });
      expect(recorded).toHaveLength(1);
      expect(contributed).toEqual([]);
    });
  });

  describe("given a log correlated to a span", () => {
    /** @scenario "A correlated log contributes to Trace without sharing ownership" */
    it("records the canonical log then sends Trace one compact contribution batch", async () => {
      const { result, recorded, contributed } = collect({ accepted: [preparedLog({})] });

      await expect(result).resolves.toEqual({
        outcome: "collected",
        acceptedLogRecords: 1,
        rejectedLogRecords: 1,
        errorMessage: "log record 2: missing body",
      });
      expect(recorded).toHaveLength(1);
      expect(contributed).toHaveLength(1);
      expect(contributed[0]?.[0]).toMatchObject({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        correlationSource: "wire",
        input: "prompt",
        liftedAttributes: { "gen_ai.system": "spring-ai" },
      });
    });

    /** @scenario "Trace contribution is best effort" */
    it("keeps the log accepted when its contribution cannot be queued", async () => {
      const { result } = collect({ accepted: [preparedLog({})], contributionFails: true });

      await expect(result).resolves.toMatchObject({ outcome: "collected", acceptedLogRecords: 1 });
    });

    it("marks the contribution when Trace cut its input or output to the preview", async () => {
      const { result, contributed } = collect({ accepted: [preparedLog({})], truncated: true });

      await result;
      expect(contributed[0]?.[0]?.liftedAttributes["langwatch.reserved.log_io_truncated"]).toBe(
        true,
      );
    });
  });

  describe("when the canonical batch cannot be recorded", () => {
    it("answers unavailable without naming the storage, and contributes nothing", async () => {
      const { result, contributed } = collect({ accepted: [preparedLog({})], recordFails: true });

      await expect(result).resolves.toEqual({
        outcome: "unavailable",
        errorMessage: "failed to record log record",
      });
      expect(contributed).toEqual([]);
    });
  });
});

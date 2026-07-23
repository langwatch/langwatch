import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecordRepository } from "~/server/app-layer/logs/repositories/canonical-log-record.repository";
import { LogRecordStorageService } from "../log-record-storage.service";
import type {
  LogRecordStorageRepository,
  StoredLogRecordRow,
} from "../repositories/log-record-storage.repository";

const row: StoredLogRecordRow = {
  traceId: "trace-1",
  spanId: "span-1",
  timeUnixMs: 1_700_000_000_000,
  body: "api_request",
  attributes: {
    "event.name": "api_request",
    request_id: "req_a",
    cost_usd: "0.02",
  },
  resourceAttributes: {},
  scopeName: "com.anthropic.claude_code.events",
  scopeVersion: null,
};

const canonicalRow: StoredLogRecordRow = {
  ...row,
  timeUnixMs: 1_700_000_000_500,
  body: "user_prompt",
  attributes: { "event.name": "user_prompt", prompt: "hi" },
};

function makeService({
  legacyRows = [row],
  canonicalRows = [] as StoredLogRecordRow[],
} = {}) {
  const getLogsByTraceId = vi.fn().mockResolvedValue(legacyRows);
  const repository = {
    insertLogRecord: vi.fn(),
    insertLogRecords: vi.fn(),
    getLogsByTraceId,
  } as unknown as LogRecordStorageRepository;
  const canonicalGetLogsByTraceId = vi.fn().mockResolvedValue(canonicalRows);
  const canonical = {
    getLogsByTraceId: canonicalGetLogsByTraceId,
  } as unknown as CanonicalLogRecordRepository;
  return {
    service: new LogRecordStorageService(repository, canonical),
    getLogsByTraceId,
    canonicalGetLogsByTraceId,
  };
}

describe("LogRecordStorageService.getLogsByTraceId", () => {
  describe("when reading a trace's logs", () => {
    it("delegates to the repository with the tenant, trace, time hint, and row cap", async () => {
      const { service, getLogsByTraceId } = makeService();

      const result = await service.getLogsByTraceId(
        "project_test",
        "trace-1",
        1_700_000_000_000,
        250,
      );

      expect(getLogsByTraceId).toHaveBeenCalledWith(
        "project_test",
        "trace-1",
        1_700_000_000_000,
        250,
      );
      expect(result).toEqual([row]);
    });

    it("passes an undefined time hint and cap straight through so the repository default applies", async () => {
      const { service, getLogsByTraceId } = makeService();

      await service.getLogsByTraceId("project_test", "trace-1");

      expect(getLogsByTraceId).toHaveBeenCalledWith(
        "project_test",
        "trace-1",
        undefined,
        undefined,
      );
    });

    it("queries the canonical store with the same read and returns rows only it holds", async () => {
      // The prod regression this pins: post-cutover traces exist ONLY in
      // canonical `log_records`, so a read that skips canonical returns []
      // and the drawer/transcript render contentless.
      const { service, canonicalGetLogsByTraceId } = makeService({
        legacyRows: [],
        canonicalRows: [canonicalRow],
      });

      const result = await service.getLogsByTraceId(
        "project_test",
        "trace-1",
        1_700_000_000_000,
        250,
      );

      expect(canonicalGetLogsByTraceId).toHaveBeenCalledWith({
        tenantId: "project_test",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
        limit: 250,
      });
      expect(result).toEqual([canonicalRow]);
    });

    it("merges legacy and canonical rows in time order", async () => {
      const { service } = makeService({
        legacyRows: [row],
        canonicalRows: [canonicalRow],
      });

      const result = await service.getLogsByTraceId("project_test", "trace-1");

      expect(result).toEqual([row, canonicalRow]);
    });
  });
});

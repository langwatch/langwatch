import { describe, expect, it, vi } from "vitest";
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

function makeService(getLogsByTraceId = vi.fn().mockResolvedValue([row])) {
  const repository = {
    insertLogRecord: vi.fn(),
    insertLogRecords: vi.fn(),
    getLogsByTraceId,
  } as unknown as LogRecordStorageRepository;
  return { service: new LogRecordStorageService(repository), getLogsByTraceId };
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
  });
});

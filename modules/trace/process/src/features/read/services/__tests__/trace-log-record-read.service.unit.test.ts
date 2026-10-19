/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-log-record-read.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
} from "../../../../repositories/log-record-storage.repository.ts";
import { MemoryLogRecordStorageRepository } from "../../../../repositories/memory/memory.log-record-storage.repository.ts";
import { LogRecordStorageService } from "../trace-log-record-read.service.ts";

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

function makeService({ storedRows = [row] } = {}) {
  const getLogsByTraceId = vi.fn().mockResolvedValue(storedRows);
  const getLogRecordsByTraceId = vi.fn().mockResolvedValue([]);
  const repository: LogRecordStorageRepository = {
    findLogsByTraceId: getLogsByTraceId,
    findLogRecordsByTraceId: getLogRecordsByTraceId,
    findLogsByTraceIds: vi.fn().mockResolvedValue([]),
    findLogRecordsByTraceIds: vi.fn().mockResolvedValue([]),
  };
  return {
    service: LogRecordStorageService.create({ repository }),
    getLogsByTraceId,
    getLogRecordsByTraceId,
  };
}

function recordOf({ body, timeUnixMs }: { body: string; timeUnixMs: number }) {
  return {
    ...row,
    tenantId: "project-1",
    timeUnixMs,
    body,
    attributes: { "event.name": body },
  };
}

describe("LogRecordStorageService.getLogsByTraceId", () => {
  describe("when reading a trace's logs", () => {
    it("delegates to the repository with the tenant, trace, time hint, and row cap", async () => {
      const { service, getLogsByTraceId, getLogRecordsByTraceId } = makeService();

      const result = await service.getLogsByTraceId({
        tenantId: "project_test",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
        limit: 250,
      });

      const query = {
        tenantId: "project_test",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
        limit: 250,
      };
      expect(getLogsByTraceId).toHaveBeenCalledWith(query);
      expect(getLogRecordsByTraceId).toHaveBeenCalledWith(query);
      expect(result).toEqual([row]);
    });

    it("passes an undefined time hint and cap straight through so the repository default applies", async () => {
      const { service, getLogsByTraceId } = makeService();

      await service.getLogsByTraceId({ tenantId: "project_test", traceId: "trace-1" });

      expect(getLogsByTraceId).toHaveBeenCalledWith({
        tenantId: "project_test",
        traceId: "trace-1",
      });
    });

    /** @scenario "Trace reads a trace's logs from log's shared log records" */
    it("answers log's records, oldest first", async () => {
      const repository = MemoryLogRecordStorageRepository.create({
        logRecords: [
          recordOf({ body: "later", timeUnixMs: 2_000 }),
          recordOf({ body: "earlier", timeUnixMs: 1_000 }),
        ],
      });
      const service = LogRecordStorageService.create({ repository });

      const rows = await service.getLogsByTraceId({ tenantId: "project-1", traceId: "trace-1" });

      expect(rows.map((stored) => stored.body)).toEqual(["earlier", "later"]);
    });

    /** @scenario "A record only in the legacy stored log records stays readable" */
    it("answers a legacy-only record beside log's records", async () => {
      const repository = MemoryLogRecordStorageRepository.create({
        storedLogRecords: [recordOf({ body: "before-cutover", timeUnixMs: 1_000 })],
        logRecords: [recordOf({ body: "after-cutover", timeUnixMs: 2_000 })],
      });
      const service = LogRecordStorageService.create({ repository });

      const rows = await service.getLogsByTraceId({ tenantId: "project-1", traceId: "trace-1" });

      expect(rows.map((stored) => stored.body)).toEqual(["before-cutover", "after-cutover"]);
    });

    /** @scenario "A record both tables hold is answered once, as log holds it" */
    it("answers a record both tables hold once, with log's body", async () => {
      const legacy = recordOf({ body: "same", timeUnixMs: 1_000 });
      const repository = MemoryLogRecordStorageRepository.create({
        storedLogRecords: [{ ...legacy, body: "legacy-body" }],
        logRecords: [{ ...legacy, body: "log-body" }],
      });
      const service = LogRecordStorageService.create({ repository });

      const rows = await service.getLogsByTraceId({ tenantId: "project-1", traceId: "trace-1" });

      expect(rows.map((stored) => stored.body)).toEqual(["log-body"]);
    });
  });
});

describe("LogRecordStorageService.getLogsByTraceIds", () => {
  describe("when reading three traces' logs at once", () => {
    /** @scenario "A batch read answers each trace's own records in one read per table" */
    it("reads each table once and answers each trace only its own records, oldest first", async () => {
      const repository = MemoryLogRecordStorageRepository.create({
        storedLogRecords: [
          { ...recordOf({ body: "t2-legacy", timeUnixMs: 500 }), traceId: "trace-2" },
        ],
        logRecords: [
          recordOf({ body: "t1-later", timeUnixMs: 2_000 }),
          recordOf({ body: "t1-earlier", timeUnixMs: 1_000 }),
          { ...recordOf({ body: "t2-log", timeUnixMs: 1_500 }), traceId: "trace-2" },
          { ...recordOf({ body: "t3-log", timeUnixMs: 3_000 }), traceId: "trace-3" },
          { ...recordOf({ body: "other-trace", timeUnixMs: 100 }), traceId: "trace-9" },
        ],
      });
      const legacyBatch = vi.spyOn(repository, "findLogsByTraceIds");
      const logBatch = vi.spyOn(repository, "findLogRecordsByTraceIds");
      const single = vi.spyOn(repository, "findLogRecordsByTraceId");
      const service = LogRecordStorageService.create({ repository });

      const byTrace = await service.getLogsByTraceIds({
        tenantId: "project-1",
        traces: [
          { traceId: "trace-1", occurredAtMs: 1_000 },
          { traceId: "trace-2", occurredAtMs: 1_500 },
          { traceId: "trace-3" },
        ],
      });

      expect(legacyBatch).toHaveBeenCalledTimes(1);
      expect(logBatch).toHaveBeenCalledTimes(1);
      expect(single).not.toHaveBeenCalled();
      expect(byTrace.get("trace-1")?.map((stored) => stored.body)).toEqual([
        "t1-earlier",
        "t1-later",
      ]);
      expect(byTrace.get("trace-2")?.map((stored) => stored.body)).toEqual(["t2-legacy", "t2-log"]);
      expect(byTrace.get("trace-3")?.map((stored) => stored.body)).toEqual(["t3-log"]);
      expect(byTrace.has("trace-9")).toBe(false);
    });
  });

  describe("when no trace is asked for", () => {
    it("reads nothing", async () => {
      const repository = MemoryLogRecordStorageRepository.create();
      const logBatch = vi.spyOn(repository, "findLogRecordsByTraceIds");
      const service = LogRecordStorageService.create({ repository });

      const byTrace = await service.getLogsByTraceIds({ tenantId: "project-1", traces: [] });

      expect(byTrace.size).toBe(0);
      expect(logBatch).not.toHaveBeenCalled();
    });
  });
});

describe("LogRecordStorageRepository.mergeStoredLogRows", () => {
  describe("given two rows that share the identity key with divergent bodies", () => {
    /** @scenario Ingested log telemetry reaches only the canonical store */
    it("keeps exactly one, and the canonical (later) value wins", () => {
      // Identity is (traceId, spanId, timeUnixMs, scopeName, sorted attributes) —
      // the body is NOT part of it. A pre-cutover legacy row and its canonical
      // re-read collide on that key, so the later (canonical) row must win and the
      // dual-read merge shows canonical content, never the stale stored body.
      const legacy: StoredLogRecordRow = {
        traceId: "trace-1",
        spanId: "span-1",
        timeUnixMs: 1_700_000_000_000,
        body: "legacy-body",
        attributes: { "event.name": "api_request", request_id: "req_a" },
        resourceAttributes: {},
        scopeName: "com.anthropic.claude_code.events",
        scopeVersion: null,
      };
      const canonical: StoredLogRecordRow = {
        ...legacy,
        body: "canonical-body",
      };

      const merged = LogRecordStorageRepository.mergeStoredLogRows([legacy, canonical]);

      expect(merged).toHaveLength(1);
      expect(merged[0]?.body).toBe("canonical-body");
    });
  });

  describe("given two rows whose attributes differ only in key order", () => {
    it("treats them as one identity rather than splitting the dedup", () => {
      // The identity key sorts attribute keys before serialising, so OTLP
      // insertion order (legacy) and the key-sorted canonical serialisation
      // resolve to the same key — the record is deduped, not double-counted.
      const base = {
        traceId: "trace-1",
        spanId: "span-1",
        timeUnixMs: 1_700_000_000_000,
        body: "b",
        resourceAttributes: {},
        scopeName: "com.anthropic.claude_code.events",
        scopeVersion: null,
      };
      const insertionOrder: StoredLogRecordRow = {
        ...base,
        attributes: { "event.name": "api_request", request_id: "req_a" },
      };
      const keySorted: StoredLogRecordRow = {
        ...base,
        attributes: { request_id: "req_a", "event.name": "api_request" },
      };

      const merged = LogRecordStorageRepository.mergeStoredLogRows([insertionOrder, keySorted]);

      expect(merged).toHaveLength(1);
    });
  });
});

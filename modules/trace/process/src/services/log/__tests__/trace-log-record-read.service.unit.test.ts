/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-log-record-read.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
} from "../../../repositories/log-record-storage.repository.ts";
import { MemoryLogRecordStorageRepository } from "../../../repositories/memory/memory.log-record-storage.repository.ts";
import { LogRecordStorageService } from "../../trace-log-record-read.service.ts";

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

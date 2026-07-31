import { describe, expect, it, vi } from "vitest";
import type { CanonicalLogRecordRepository } from "~/server/app-layer/logs/repositories/canonical-log-record.repository";
import { LogRecordStorageService } from "../log-record-storage.service";
import type {
  LogRecordStorageRepository,
  StoredLogRecordRow,
} from "../repositories/log-record-storage.repository";
import { mergeStoredLogRows } from "../repositories/log-record-storage.repository";

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
    getLogsByTraceId,
  } as unknown as LogRecordStorageRepository;
  const canonicalGetLogsByTraceId = vi.fn().mockResolvedValue(canonicalRows);
  const canonical = {
    getLogsByTraceId: canonicalGetLogsByTraceId,
  } as unknown as CanonicalLogRecordRepository;
  return {
    service: new LogRecordStorageService({ repository, canonical }),
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

describe("mergeStoredLogRows", () => {
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

      const merged = mergeStoredLogRows([legacy, canonical]);

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

      const merged = mergeStoredLogRows([insertionOrder, keySorted]);

      expect(merged).toHaveLength(1);
    });
  });
});

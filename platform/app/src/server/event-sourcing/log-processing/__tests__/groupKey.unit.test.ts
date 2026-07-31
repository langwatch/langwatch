import { renderGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  canonicalLogStorageGroupKey,
  logRecordCommandGroupKey,
} from "../index";
import {
  DEFAULT_LOG_SHARD_COUNT,
  logRecordShard,
  MAX_LOG_SHARD_COUNT,
  MIN_LOG_SHARD_COUNT,
} from "../shards";

describe("log-processing group keys", () => {
  describe("given the command lane", () => {
    it("scopes to the aggregate — one lane per record id, the ADR-100 default", () => {
      const key = logRecordCommandGroupKey({
        tenantId: "tenant-1",
        recordId: "a".repeat(64),
      });
      expect(key).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "command", name: "recordCanonicalLog" },
        scope: {
          kind: "aggregate",
          aggregateType: "log",
          aggregateId: "a".repeat(64),
        },
      });
    });

    /** @scenario A log record's aggregate id is its own content hash */
    it("scopes the command lane to exactly the record's own recordId, however the record reached it", () => {
      // There is no separate "derive the aggregate id" step any more — a
      // content-addressed pipeline has no fold to key, so the recordId a
      // caller supplies is the aggregate id, unchanged (ADR-105 decision 4).
      // Its stability across redeliveries is `recordId`'s own contract,
      // covered where it is produced: canonicalize.unit.test.ts.
      const recordId = "b".repeat(64);
      const first = logRecordCommandGroupKey({
        tenantId: "tenant-1",
        recordId,
      });
      const second = logRecordCommandGroupKey({
        tenantId: "tenant-1",
        recordId: "b".repeat(64),
      });
      expect(first.scope).toEqual({
        kind: "aggregate",
        aggregateType: "log",
        aggregateId: recordId,
      });
      expect(second.scope).toEqual(first.scope);
    });

    it("renders to a key that carries the tenant, so two tenants never share a lane", () => {
      const a = renderGroupKey(
        logRecordCommandGroupKey({
          tenantId: "tenant-a",
          recordId: "x".repeat(64),
        }),
      );
      const b = renderGroupKey(
        logRecordCommandGroupKey({
          tenantId: "tenant-b",
          recordId: "x".repeat(64),
        }),
      );
      expect(a).not.toBe(b);
    });

    /** @scenario The command lane needs no sharding beyond the default aggregate scope */
    it("scopes two different records' commands to two different aggregate lanes", () => {
      const a = logRecordCommandGroupKey({
        tenantId: "tenant-1",
        recordId: "a".repeat(64),
      });
      const b = logRecordCommandGroupKey({
        tenantId: "tenant-1",
        recordId: "b".repeat(64),
      });
      expect(a.scope).toEqual({
        kind: "aggregate",
        aggregateType: "log",
        aggregateId: "a".repeat(64),
      });
      expect(b.scope).toEqual({
        kind: "aggregate",
        aggregateType: "log",
        aggregateId: "b".repeat(64),
      });
      expect(renderGroupKey(a)).not.toBe(renderGroupKey(b));
    });
  });

  describe("given the canonicalLogStorage projection lane", () => {
    it("assigns a stable shard for a given record id", () => {
      const recordId = "a".repeat(64);
      expect(logRecordShard(recordId, 16)).toBe(logRecordShard(recordId, 16));
    });

    it("bounds the shard below the configured count", () => {
      const shard = logRecordShard("b".repeat(64), 16);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(16);
    });

    it("scopes to a hashed partition, not the aggregate, so writes can coalesce", () => {
      const key = canonicalLogStorageGroupKey({
        tenantId: "tenant-1",
        recordId: "c".repeat(64),
        shardCount: 16,
      });
      expect(key.lane).toEqual({ kind: "map", name: "canonicalLogStorage" });
      expect(key.scope.kind).toBe("partition");
    });

    /** @scenario The projection lane shards records so their writes can coalesce */
    it("places two different records that hash to the same shard in one lane", () => {
      // Two distinct record ids landing on the same shard must render to the
      // *same* group key — that shared lane is the entire reason batching is
      // possible, so this is the property the partition scope exists for.
      const shardCount = 4;
      const ids = Array.from({ length: 64 }, (_, i) =>
        `${i}`.repeat(64).slice(0, 64),
      );
      const byShard = new Map<number, string[]>();
      for (const id of ids) {
        const shard = logRecordShard(id, shardCount);
        byShard.set(shard, [...(byShard.get(shard) ?? []), id]);
      }
      const [shardWithTwo] = [...byShard.entries()].find(
        ([, members]) => members.length >= 2,
      )!;
      const members = byShard.get(shardWithTwo)!;
      const keys = members.map((id) =>
        renderGroupKey(
          canonicalLogStorageGroupKey({
            tenantId: "tenant-1",
            recordId: id,
            shardCount,
          }),
        ),
      );
      expect(new Set(keys).size).toBe(1);
    });
  });

  describe("given the configured shard bounds", () => {
    it("clamps a request below the minimum up, and one above the maximum down", () => {
      expect(logRecordShard("a".repeat(64), 0)).toBeLessThan(
        MIN_LOG_SHARD_COUNT + 1,
      );
      const shard = logRecordShard("a".repeat(64), 100_000);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(MAX_LOG_SHARD_COUNT);
    });

    it("defaults the projection lane's shard count when the caller names none", () => {
      expect(
        canonicalLogStorageGroupKey({
          tenantId: "tenant-1",
          recordId: "d".repeat(64),
        }),
      ).toEqual(
        canonicalLogStorageGroupKey({
          tenantId: "tenant-1",
          recordId: "d".repeat(64),
          shardCount: DEFAULT_LOG_SHARD_COUNT,
        }),
      );
    });
  });
});

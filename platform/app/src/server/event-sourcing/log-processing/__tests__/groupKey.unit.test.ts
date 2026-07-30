import { renderGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  canonicalLogStorageGroupKey,
  DEFAULT_LOG_SHARD_COUNT,
  logRecordCommandGroupKey,
  logRecordShard,
  MAX_LOG_SHARD_COUNT,
  MIN_LOG_SHARD_COUNT,
  resolveLogShardCount,
} from "../groupKey";

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

  describe("given a configured shard count", () => {
    it("falls back to the default when unset", () => {
      expect(resolveLogShardCount(undefined)).toBe(DEFAULT_LOG_SHARD_COUNT);
    });

    it("clamps below the minimum", () => {
      expect(resolveLogShardCount("0")).toBe(MIN_LOG_SHARD_COUNT);
    });

    it("clamps above the maximum", () => {
      expect(resolveLogShardCount("100000")).toBe(MAX_LOG_SHARD_COUNT);
    });

    it("falls back to the default for a non-numeric value", () => {
      expect(resolveLogShardCount("not-a-number")).toBe(
        DEFAULT_LOG_SHARD_COUNT,
      );
    });
  });
});

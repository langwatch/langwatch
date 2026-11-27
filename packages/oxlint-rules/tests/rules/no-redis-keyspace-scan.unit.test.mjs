import { afterAll, describe, expect, it } from "vitest";

import { noRedisKeyspaceScanRule } from "../../src/rules/no-redis-keyspace-scan.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const LIVE = "packages/eventing/src/replay/replayDrain.ts";

function report(code, filename = LIVE) {
  return runRule(noRedisKeyspaceScanRule, { code, cwd: workspace.cwd, filename });
}

describe("given a Redis client used on a live path", () => {
  describe("when it calls scan with MATCH or COUNT", () => {
    /** @scenario "A keyspace scan on a live path is reported" */
    it("reports keyspaceScan on the call's line", () => {
      const found = report(
        [
          "async function drain(redis) {",
          '  return redis.scan(cursor, "MATCH", "gq:*", "COUNT", 100);',
          "}",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.data.method])).toEqual([[2, "scan"]]);
      expect(found[0].message).toBe(
        "`.scan(...)` walks the Redis keyspace on a live path. A SCAN reads every key in Redis whatever MATCH says." +
          " Keep an index the owner writes (ADR-092) or add a budgeted, paced walk to the allowlist in no-redis-keyspace-scan with its reason. Read the `eventing-and-worker` skill.",
      );
    });
  });

  describe("when it opens a scanStream", () => {
    it("reports keyspaceScan", () => {
      const found = report("const stream = redis.scanStream({ match: 'gq:*' });");

      expect(found.map((finding) => finding.data.method)).toEqual(["scanStream"]);
    });
  });

  describe("when it scans from a bare cursor", () => {
    /** @scenario "A bare cursor scan on a Redis client is reported" */
    it("reports keyspaceScan on each call", () => {
      const found = report(
        [
          "redis.scan(cursor);",
          "this.redis.scan(cursor);",
          'connection.scanBuffer("0");',
          'redis["scan"](cursor);',
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.data.method])).toEqual([
        [1, "scan"],
        [2, "scan"],
        [3, "scanBuffer"],
        [4, "scan"],
      ]);
    });
  });

  describe("when it walks the keyspace in another spelling", () => {
    /** @scenario "A keyspace walk in any other spelling is reported" */
    it("reports keyspaceScan on each call", () => {
      const found = report(
        [
          "adapter.scan(cursor, { MATCH: pattern, COUNT: 100 });",
          "adapter.scan(cursor, `MATCH`, pattern);",
          "redis.scanBufferStream({ match: 'gq:*' });",
          "for await (const key of client.scanIterator({ MATCH: 'gq:*' })) {}",
          'store.keys("gq:*");',
          'redis.call("SCAN", cursor, "MATCH", pattern);',
          "conn.scan(cursor);",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.data.method])).toEqual([
        [1, "scan"],
        [2, "scan"],
        [3, "scanBufferStream"],
        [4, "scanIterator"],
        [5, "keys"],
        [6, "call"],
        [7, "scan"],
      ]);
    });
  });

  describe("when a Lua script walks the keyspace", () => {
    /** @scenario "A SCAN or KEYS inside a Lua script is reported" */
    it("reports luaKeyspaceScan naming the command", () => {
      const found = report(
        [
          'const A = "local r = redis.call(\\"SCAN\\", ARGV[1])";',
          "const B = `for _, k in ipairs(redis.call('KEYS', ARGV[1])) do end`;",
          "const C = `local page = redis.call ( 'scan', ARGV[1])`;",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.data.command])).toEqual([
        [1, "SCAN"],
        [2, "KEYS"],
        [3, "SCAN"],
      ]);
    });
  });

  describe("when an unrelated object has a scan method", () => {
    /** @scenario "Unrelated scan methods are left alone" */
    it("reports nothing", () => {
      const found = report(
        [
          "scanner.scan();",
          "recognizer.scan(text);",
          "adapter.scan(prefix);",
          "adapter.scan('prefix');",
          "Object.keys(row);",
          "map.keys();",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a budgeted, paced walk", () => {
  describe("when its file is on the allowlist", () => {
    /** @scenario "An allowlisted paced walk is left alone" */
    it("reports nothing", () => {
      const code = 'redis.scan(cursor, "MATCH", "gq:*", "COUNT", 100);';

      expect(report(code, "packages/group-queue/src/blobSweeper.ts")).toEqual([]);
      expect(report(code, "packages/group-queue/src/tenantClaims.ts")).toEqual([]);
    });
  });
});

describe("given a test file", () => {
  describe("when it scans the keyspace", () => {
    /** @scenario "A test file may walk the keyspace" */
    it("reports nothing", () => {
      const code = 'redis.scan(cursor, "MATCH", "gq:*");';

      expect(
        report(code, "packages/eventing/src/replay/__tests__/replayDrain.unit.test.ts"),
      ).toEqual([]);
    });
  });
});

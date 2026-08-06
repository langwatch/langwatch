import { describe, expect, it } from "vitest";

import {
  isRedisCommandTracingEnabled,
  MAX_DB_STATEMENT_CHARS,
  redisInstrumentationConfig,
  redisStatementSerializer,
} from "../instrumentation.redis";

/**
 * The flag exists because instrumenting ioredis in a process that owns a BullMQ
 * queue traces the queue's own bookkeeping: measured in production at ~32 Redis
 * spans per job, 93% of every span the platform emitted. A regression that
 * turns this back on is silent and is only noticed on a bill, so the default
 * and the exact-match parsing are pinned here rather than left to a comment.
 */
describe("isRedisCommandTracingEnabled", () => {
  it("is off when the variable is absent", () => {
    expect(isRedisCommandTracingEnabled({})).toBe(false);
  });

  it('is on only for exactly "true"', () => {
    expect(
      isRedisCommandTracingEnabled({ OTEL_TRACE_REDIS_COMMANDS: "true" }),
    ).toBe(true);
  });

  // Being wrong in this direction costs money, so anything that merely looks
  // affirmative stays off.
  it.each([
    "false",
    "1",
    "yes",
    "TRUE",
    "True",
    " true",
    "",
  ])("stays off for %j", (value) => {
    expect(
      isRedisCommandTracingEnabled({ OTEL_TRACE_REDIS_COMMANDS: value }),
    ).toBe(false);
  });

  it("reads process.env when no environment is passed", () => {
    const previous = process.env.OTEL_TRACE_REDIS_COMMANDS;
    try {
      process.env.OTEL_TRACE_REDIS_COMMANDS = "true";
      expect(isRedisCommandTracingEnabled()).toBe(true);

      delete process.env.OTEL_TRACE_REDIS_COMMANDS;
      expect(isRedisCommandTracingEnabled()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OTEL_TRACE_REDIS_COMMANDS;
      } else {
        process.env.OTEL_TRACE_REDIS_COMMANDS = previous;
      }
    }
  });
});

describe("redisStatementSerializer", () => {
  it("keeps the command and its first key", () => {
    expect(redisStatementSerializer("get", ["session:abc"])).toBe(
      "get session:abc",
    );
  });

  it("drops the values, so a span cannot carry secrets", () => {
    expect(
      redisStatementSerializer("set", ["session:abc", "a-secret-token"]),
    ).toBe("set session:abc");
  });

  it("returns the bare command when there are no arguments", () => {
    expect(redisStatementSerializer("ping", [])).toBe("ping");
  });

  it("returns the bare command when the first argument is not a string", () => {
    expect(redisStatementSerializer("expire", [42])).toBe("expire");
    expect(redisStatementSerializer("mset", [["a", "b"]])).toBe("mset");
    expect(redisStatementSerializer("get", [Buffer.from("key")])).toBe("get");
  });

  // Dropping the values is not enough on its own: the key is caller-controlled,
  // so an unbounded one would reintroduce the large attribute this exists to
  // prevent.
  describe("when the key would exceed the cap", () => {
    const hugeKey = "k".repeat(MAX_DB_STATEMENT_CHARS * 2);

    it("caps the statement at the maximum, marker included", () => {
      const statement = redisStatementSerializer("get", [hugeKey]);

      expect(statement).toHaveLength(MAX_DB_STATEMENT_CHARS);
    });

    it("marks the truncation, so a shortened key cannot pass for a real one", () => {
      expect(redisStatementSerializer("get", [hugeKey])).toMatch(/\.\.\.$/);
      expect(redisStatementSerializer("get", [hugeKey])).toMatch(
        /^get k+\.\.\.$/,
      );
    });

    it("leaves a statement exactly at the cap untouched", () => {
      const exactKey = "k".repeat(MAX_DB_STATEMENT_CHARS - "get ".length);
      const statement = redisStatementSerializer("get", [exactKey]);

      expect(statement).toHaveLength(MAX_DB_STATEMENT_CHARS);
      expect(statement).not.toMatch(/\.\.\.$/);
    });

    it("leaves a statement one under the cap untouched", () => {
      const nearKey = "k".repeat(MAX_DB_STATEMENT_CHARS - "get ".length - 1);

      expect(redisStatementSerializer("get", [nearKey])).toBe(`get ${nearKey}`);
    });
  });

  it("returns the bare command for an empty-string key", () => {
    expect(redisStatementSerializer("get", [""])).toBe("get");
  });
});

describe("redisInstrumentationConfig", () => {
  // Without this, the connection pool's connect/auth/info and the queue
  // dispatcher's blocking brpop/xread become root spans and bury real traces.
  it("requires a parent span", () => {
    expect(redisInstrumentationConfig.requireParentSpan).toBe(true);
  });

  it("uses the truncating serializer", () => {
    expect(redisInstrumentationConfig.dbStatementSerializer).toBe(
      redisStatementSerializer,
    );
  });
});

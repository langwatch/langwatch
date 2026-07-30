import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ch, ColumnDecodeError } from "./columns";

/**
 * These tests guard the two properties ADR-099 depends on: a column decodes
 * the wire value without losing information (bigint precision, calendar
 * fields, null-vs-absent), and it throws rather than silently coercing a
 * value it cannot represent — a `NaN` or a rolled-over date written back to
 * ClickHouse is worse than a loud failure at read time.
 */

describe("ch.string", () => {
  const col = ch.string();

  describe("given a wire cell", () => {
    it("round-trips a plain string", () => {
      const wire = col.encode(col.decode("hello"));
      expect(col.decode(wire)).toBe("hello");
    });
  });

  describe("given a malformed cell", () => {
    it("throws instead of stringifying a number", () => {
      expect(() => col.decode(42)).toThrow();
    });
  });
});

describe("ch.uint64", () => {
  const col = ch.uint64();

  describe("given a value beyond Number.MAX_SAFE_INTEGER", () => {
    it("round-trips without precision loss", () => {
      const beyondSafeInteger = 9_007_199_254_740_993n; // 2^53 + 1
      const wire = col.encode(beyondSafeInteger);
      expect(col.decode(wire)).toBe(beyondSafeInteger);
    });

    it("decodes to a bigint, not a number", () => {
      expect(typeof col.decode("9007199254740993")).toBe("bigint");
    });
  });

  describe("given a malformed cell", () => {
    it("throws on a negative value", () => {
      expect(() => col.decode("-1")).toThrow();
    });

    it("throws on a non-numeric string", () => {
      expect(() => col.decode("not-a-number")).toThrow();
    });

    it("throws when handed a JS number instead of the wire string", () => {
      expect(() => col.decode(42)).toThrow();
    });
  });
});

describe("ch.int64", () => {
  const col = ch.int64();

  describe("given a negative value beyond the safe integer range", () => {
    it("round-trips without precision loss", () => {
      const value = -9_007_199_254_740_993n;
      expect(col.decode(col.encode(value))).toBe(value);
    });
  });

  describe("given a malformed cell", () => {
    it("throws on a value with a stray sign", () => {
      expect(() => col.decode("1-2")).toThrow();
    });
  });
});

describe("ch.float64", () => {
  const col = ch.float64();

  describe("given the ClickHouse denormal string forms", () => {
    it("decodes nan, inf and -inf", () => {
      expect(col.decode("nan")).toBeNaN();
      expect(col.decode("inf")).toBe(Infinity);
      expect(col.decode("-inf")).toBe(-Infinity);
    });
  });

  describe("given a plain number cell", () => {
    it("round-trips a fractional value", () => {
      expect(col.decode(col.encode(3.5))).toBe(3.5);
    });
  });

  describe("given a malformed cell", () => {
    it("throws on an arbitrary string instead of coercing via Number()", () => {
      expect(() => col.decode("not-a-float")).toThrow();
    });
  });
});

describe("ch.boolean", () => {
  const col = ch.boolean();

  it("round-trips true and false", () => {
    expect(col.decode(col.encode(true))).toBe(true);
    expect(col.decode(col.encode(false))).toBe(false);
  });

  describe("given a malformed cell", () => {
    it("throws on ClickHouse's 0/1 integer form", () => {
      expect(() => col.decode(1)).toThrow();
    });
  });
});

describe("ch.dateTime64", () => {
  const col = ch.dateTime64(3);

  describe("given a wire value", () => {
    it("round-trips through the space-separated ClickHouse form", () => {
      const original = new Date(Date.UTC(2024, 0, 15, 10, 30, 0, 123));
      const wire = col.encode(original);
      expect(wire).toBe("2024-01-15 10:30:00.123");
      expect(col.decode(wire)).toEqual(original);
    });

    it("decodes a value with no fractional part", () => {
      const decoded = col.decode("2024-01-15 10:30:00");
      expect(decoded).toEqual(new Date(Date.UTC(2024, 0, 15, 10, 30, 0, 0)));
    });
  });

  describe("given a malformed cell", () => {
    it("throws on a T-separated ISO string rather than the ClickHouse form", () => {
      expect(() => col.decode("2024-01-15T10:30:00.123Z")).toThrow();
    });

    it("throws on a calendar date that does not exist, instead of rolling it forward", () => {
      expect(() => col.decode("2024-02-30 00:00:00.000")).toThrow();
    });
  });
});

describe("ch.date", () => {
  const col = ch.date();

  it("round-trips a calendar date", () => {
    const original = new Date(Date.UTC(2024, 5, 1));
    expect(col.decode(col.encode(original))).toEqual(original);
  });

  describe("given a malformed cell", () => {
    it("throws on a date with an out-of-range day", () => {
      expect(() => col.decode("2024-04-31")).toThrow();
    });
  });
});

describe("ch.map", () => {
  const col = ch.map(ch.string(), ch.uint64());

  describe("given a wire object", () => {
    it("round-trips key/value pairs through a JS Map", () => {
      const original = new Map([
        ["a", 1n],
        ["b", 9_007_199_254_740_993n],
      ]);
      const wire = col.encode(original);
      expect(col.decode(wire)).toEqual(original);
    });

    it("decodes an empty object to an empty map", () => {
      expect(col.decode({})).toEqual(new Map());
    });
  });

  describe("given a malformed cell", () => {
    it("throws when handed an array instead of an object", () => {
      expect(() => col.decode([["a", "1"]])).toThrow();
    });

    it("throws when a value cannot decode against the value column", () => {
      expect(() => col.decode({ a: "not-a-number" })).toThrow();
    });
  });
});

describe("ch.array", () => {
  const col = ch.array(ch.uint64());

  it("round-trips a list of values", () => {
    const original = [1n, 2n, 3n];
    expect(col.decode(col.encode(original))).toEqual(original);
  });

  describe("given a malformed cell", () => {
    it("throws when handed an object instead of an array", () => {
      expect(() => col.decode({ 0: "1" })).toThrow();
    });

    it("throws when one element fails its own column decode", () => {
      expect(() => col.decode(["1", "not-a-number"])).toThrow();
    });
  });
});

describe("ch.nullable", () => {
  const col = ch.nullable(ch.uint64());

  describe("given a wire cell", () => {
    it("decodes ClickHouse's null to null", () => {
      expect(col.decode(null)).toBeNull();
    });

    it("decodes a present value through the inner column", () => {
      expect(col.decode("5")).toBe(5n);
    });

    it("encodes null back to null rather than to the inner column's encode", () => {
      expect(col.encode(null)).toBeNull();
    });
  });

  it("reports nullable true", () => {
    expect(col.nullable).toBe(true);
  });

  describe("given an inner column that carries a time role and both flags", () => {
    // Wrapping the one role that is frozen AND platform-controlled is what
    // makes this a real check: an implementation that hardcoded the flags, or
    // dropped the role, still matches a `ch.uint64()` inner column, because
    // every flag on that one is already false.
    it("carries the inner column's role and flags through the wrapper", () => {
      const nullableAnchor = ch.nullable(ch.acceptedAt());

      expect(nullableAnchor.timeRole).toBe("acceptedAt");
      expect(nullableAnchor.frozen).toBe(true);
      expect(nullableAnchor.platformControlled).toBe(true);
      expect(nullableAnchor.chType).toBe("Nullable(DateTime64(3))");
    });
  });

  describe("given a malformed non-null cell", () => {
    it("still throws through the inner column's decode", () => {
      expect(() => col.decode("not-a-number")).toThrow();
    });
  });
});

describe("ch.lowCardinality", () => {
  const col = ch.lowCardinality(ch.string());

  it("wraps the ClickHouse type name without changing the wire shape", () => {
    expect(col.chType).toBe("LowCardinality(String)");
    expect(col.decode("x")).toBe("x");
    expect(col.encode("x")).toBe("x");
  });
});

describe("ch.enum_", () => {
  const col = ch.enum_({ pending: 1, done: 2 });

  it("declares an Enum8 type naming each label and ordinal", () => {
    expect(col.chType).toBe("Enum8('pending' = 1, 'done' = 2)");
  });

  it("round-trips a known label", () => {
    expect(col.decode(col.encode("done"))).toBe("done");
  });

  describe("given a malformed cell", () => {
    it("throws on a label outside the declared set", () => {
      expect(() => col.decode("unknown")).toThrow();
    });

    it("throws on the numeric ordinal instead of the label", () => {
      expect(() => col.decode(1)).toThrow();
    });
  });
});

describe("ch.json", () => {
  const col = ch.json(z.object({ count: z.number() }));

  it("round-trips a JSON-shaped payload stored as a String column", () => {
    expect(col.chType).toBe("String");
    const original = { count: 3 };
    expect(col.decode(col.encode(original))).toEqual(original);
  });

  describe("given a malformed cell", () => {
    it("throws on a string that is not valid JSON", () => {
      expect(() => col.decode("{not json")).toThrow();
    });

    it("throws when the parsed JSON does not match the declared schema", () => {
      expect(() => col.decode(JSON.stringify({ count: "not-a-number" }))).toThrow();
    });
  });
});

describe("time roles", () => {
  describe("given occurredAt", () => {
    it("is neither frozen nor platform-controlled, and moves", () => {
      const col = ch.occurredAt();
      expect(col.timeRole).toBe("occurredAt");
      expect(col.frozen).toBe(false);
      expect(col.platformControlled).toBe(false);
    });
  });

  describe("given acceptedAt", () => {
    it("is both frozen and platform-controlled", () => {
      const col = ch.acceptedAt();
      expect(col.timeRole).toBe("acceptedAt");
      expect(col.frozen).toBe(true);
      expect(col.platformControlled).toBe(true);
    });
  });

  describe("given lastAcceptedAt", () => {
    it("is platform-controlled but not frozen", () => {
      const col = ch.lastAcceptedAt();
      expect(col.timeRole).toBe("lastAcceptedAt");
      expect(col.frozen).toBe(false);
      expect(col.platformControlled).toBe(true);
    });
  });

  describe("given writtenAt", () => {
    it("is platform-controlled but not frozen", () => {
      const col = ch.writtenAt();
      expect(col.timeRole).toBe("writtenAt");
      expect(col.frozen).toBe(false);
      expect(col.platformControlled).toBe(true);
    });
  });

  describe("given no explicit precision", () => {
    it("defaults every time-role column to DateTime64(3)", () => {
      expect(ch.occurredAt().chType).toBe("DateTime64(3)");
      expect(ch.acceptedAt().chType).toBe("DateTime64(3)");
      expect(ch.lastAcceptedAt().chType).toBe("DateTime64(3)");
      expect(ch.writtenAt().chType).toBe("DateTime64(3)");
    });
  });
});


describe("ColumnDecodeError", () => {
  describe("given a map whose key column cannot encode to a string", () => {
    it("names the ClickHouse type and the offending value", () => {
      const badKeyCol = ch.nullable(ch.string());
      const col = ch.map(badKeyCol, ch.string());
      try {
        col.encode(new Map([[null, "x"]]));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ColumnDecodeError);
        const decodeError = error as ColumnDecodeError;
        expect(decodeError.chType).toBe("Map(Nullable(String), String)");
        expect(decodeError.cell).toBeNull();
      }
    });
  });
});

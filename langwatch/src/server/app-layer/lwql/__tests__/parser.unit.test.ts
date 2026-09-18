/**
 * Text front-end tests (ADR-081 decision 9).
 *
 * Two things are under test, and they pull in opposite directions:
 *
 *   1. The parser now accepts ordinary SQL. Every construct in "constructs the
 *      hand-rolled parser got wrong" is a case the previous tokenizer mis-lexed
 *      or refused — they are regression tests against re-hand-rolling.
 *   2. Adopting a general-purpose parser must not widen the language. The
 *      rejection tests assert the walker *refuses* — not that it quietly drops
 *      the clause it does not understand, which is the failure mode that turns
 *      a parser upgrade into a security incident. Each one therefore asserts a
 *      throw, never a parse-with-missing-clause.
 */

import { describe, expect, it } from "vitest";

import { LwqlError } from "../errors";
import { parseLwql } from "../parser";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const parse = (text: string) => parseLwql(text, { now: NOW });

/** Asserts a refusal, and returns it so the message can be inspected. */
const refusal = (text: string): LwqlError => {
  try {
    parse(text);
  } catch (error) {
    expect(error).toBeInstanceOf(LwqlError);
    return error as LwqlError;
  }
  throw new Error(`expected '${text}' to be rejected, but it parsed`);
};

describe("the shape the language always had", () => {
  it("walks the documented example into IR", () => {
    expect(
      parse(`SELECT model, avg(cost_usd) AS c, count(*)
             FROM traces
             WHERE has_error = true AND started_at >= now() - INTERVAL 24 HOUR
             GROUP BY model
             ORDER BY c DESC
             LIMIT 100`),
    ).toEqual({
      from: "traces",
      select: [
        { field: "model" },
        { field: "cost_usd", fn: "avg", fnRaw: "AVG", as: "c" },
        { field: "*", fn: "count", fnRaw: "COUNT" },
      ],
      where: {
        and: [
          { field: "has_error", op: "=", value: true },
          { field: "started_at", op: ">=", value: NOW - 24 * HOUR_MS },
        ],
      },
      group_by: ["model"],
      order_by: [{ field: "c", direction: "desc" }],
      limit: 100,
    });
  });

  it("keeps OR groups nested inside the AND that contains them", () => {
    expect(
      parse(
        "SELECT trace_id FROM traces WHERE model = 'a' AND (has_error = true OR span_count > 0)",
      ).where,
    ).toEqual({
      and: [
        { field: "model", op: "=", value: "a" },
        {
          or: [
            { field: "has_error", op: "=", value: true },
            { field: "span_count", op: ">", value: 0 },
          ],
        },
      ],
    });
  });

  it("flattens a long AND chain instead of nesting it one level per term", () => {
    // The parser builds `a AND b AND c` left-nested. Left as-is it would burn
    // the depth budget on the number of filters rather than on real nesting.
    const text = `SELECT trace_id FROM traces WHERE ${Array.from(
      { length: 20 },
      (_, i) => `span_count > ${i}`,
    ).join(" AND ")}`;

    const where = parse(text).where as { and: unknown[] };
    expect(where.and).toHaveLength(20);
  });

  it("reads both spellings of NOT, IN, LIKE and IS NULL", () => {
    expect(
      parse("SELECT trace_id FROM traces WHERE NOT has_error = true").where,
    ).toEqual({ not: { field: "has_error", op: "=", value: true } });

    expect(
      parse("SELECT trace_id FROM traces WHERE NOT (has_error = true)").where,
    ).toEqual({ not: { field: "has_error", op: "=", value: true } });

    expect(
      parse("SELECT trace_id FROM traces WHERE model NOT IN ('a', 'b')").where,
    ).toEqual({ field: "model", op: "not_in", value: ["a", "b"] });

    expect(
      parse("SELECT trace_id FROM traces WHERE model NOT LIKE '%x%'").where,
    ).toEqual({ field: "model", op: "not_like", value: "%x%" });

    expect(
      parse("SELECT trace_id FROM traces WHERE topic_id IS NOT NULL").where,
    ).toEqual({ field: "topic_id", op: "is_not_null" });
  });

  it("lowercases names, as SQL does", () => {
    expect(parse("SELECT Trace_Id AS Ident FROM Traces")).toEqual({
      from: "traces",
      select: [{ field: "trace_id", as: "ident" }],
    });
  });

  it("reads LIMIT and OFFSET together and apart", () => {
    expect(parse("SELECT trace_id FROM traces LIMIT 10 OFFSET 5")).toMatchObject(
      { limit: 10, offset: 5 },
    );
    expect(parse("SELECT trace_id FROM traces OFFSET 5")).toMatchObject({
      offset: 5,
    });
    expect(parse("SELECT trace_id FROM traces LIMIT 10")).toMatchObject({
      limit: 10,
    });
  });
});

describe("constructs the hand-rolled parser got wrong (ADR-081 decision 9)", () => {
  it("reads a negative literal", () => {
    expect(
      parse("SELECT trace_id FROM traces WHERE duration_ms > -1").where,
    ).toEqual({ field: "duration_ms", op: ">", value: -1 });
  });

  it("reads an exponent literal", () => {
    // The old tokenizer consumed trailing letters greedily, so `1e5` lexed as
    // one token and `Number("1e5")` was never reached in the shape it expected.
    expect(
      parse("SELECT trace_id FROM traces WHERE duration_ms > 1e5").where,
    ).toEqual({ field: "duration_ms", op: ">", value: 100_000 });
  });

  it("reads a leading-dot decimal", () => {
    expect(
      parse("SELECT trace_id FROM traces WHERE cost_usd > .5").where,
    ).toEqual({ field: "cost_usd", op: ">", value: 0.5 });
  });

  it("accepts a trailing semicolon", () => {
    expect(parse("SELECT trace_id FROM traces;")).toEqual({
      from: "traces",
      select: [{ field: "trace_id" }],
    });
  });

  it("accepts an alias written without AS", () => {
    expect(parse("SELECT cost_usd c FROM traces")).toEqual({
      from: "traces",
      select: [{ field: "cost_usd", as: "c" }],
    });
  });

  it("unescapes SQL's doubled quote", () => {
    expect(
      parse("SELECT trace_id FROM traces WHERE topic_id = 'o''brien'").where,
    ).toEqual({ field: "topic_id", op: "=", value: "o'brien" });
  });
});

describe("durations", () => {
  it("reads INTERVAL <n> <unit>", () => {
    expect(
      parse(
        "SELECT trace_id FROM traces WHERE started_at >= now() - INTERVAL 7 DAY",
      ).where,
    ).toEqual({ field: "started_at", op: ">=", value: NOW - 7 * DAY_MS });
  });

  it("reads the quoted shorthand", () => {
    expect(
      parse(
        "SELECT trace_id FROM traces WHERE started_at >= now() - INTERVAL '24h'",
      ).where,
    ).toEqual({ field: "started_at", op: ">=", value: NOW - 24 * HOUR_MS });
  });

  it("reads addition as well as subtraction, and a bare now()", () => {
    expect(
      parse(
        "SELECT trace_id FROM traces WHERE started_at <= now() + INTERVAL 1 DAY",
      ).where,
    ).toEqual({ field: "started_at", op: "<=", value: NOW + DAY_MS });

    expect(
      parse("SELECT trace_id FROM traces WHERE started_at <= now()").where,
    ).toEqual({ field: "started_at", op: "<=", value: NOW });
  });

  it("refuses a unit it cannot convert rather than guessing", () => {
    expect(
      refusal(
        "SELECT trace_id FROM traces WHERE started_at >= now() - INTERVAL 1 MONTH",
      ).message,
    ).toMatch(/not a valid duration/);
  });

  it("teaches the INTERVAL form when a bare duration is written", () => {
    // `24h` was valid in the hand-rolled dialect and is a syntax error in SQL.
    expect(
      refusal(
        "SELECT trace_id FROM traces WHERE started_at >= now() - 24h",
      ).hint,
    ).toMatch(/INTERVAL/);
  });
});

describe("the walker refuses what it does not understand", () => {
  it("refuses a second statement", () => {
    expect(refusal("SELECT trace_id FROM traces; DROP TABLE traces").message)
      .toMatch(/Only one statement/);
  });

  it("refuses a second statement hidden behind a comment", () => {
    // The comment ends at the newline, so the DROP is a real second statement
    // and must be refused — not silently dropped along with the comment.
    expect(
      refusal("SELECT trace_id FROM traces -- keep going\n; DROP TABLE traces")
        .message,
    ).toMatch(/Only one statement/);
  });

  it("refuses a statement that is not a SELECT", () => {
    expect(refusal("DROP TABLE traces").message).toMatch(/Only SELECT/);
    expect(refusal("DELETE FROM traces").message).toMatch(/Only SELECT/);
    expect(refusal("UPDATE traces SET trace_id = 'x'").message).toMatch(
      /Only SELECT/,
    );
  });

  it("refuses a subquery, in FROM and in a value list", () => {
    expect(
      refusal("SELECT trace_id FROM (SELECT trace_id FROM traces) t").message,
    ).toMatch(/Subqueries are not supported/);

    expect(
      refusal(
        "SELECT trace_id FROM traces WHERE trace_id IN (SELECT trace_id FROM spans)",
      ).message,
    ).toMatch(/Subqueries are not supported/);

    expect(
      refusal(
        "SELECT trace_id FROM traces WHERE EXISTS (SELECT trace_id FROM spans)",
      ).message,
    ).toMatch(/not supported in WHERE/);
  });

  it("refuses UNION", () => {
    expect(
      refusal("SELECT trace_id FROM traces UNION SELECT trace_id FROM spans")
        .message,
    ).toMatch(/UNION/);
  });

  it("refuses a JOIN", () => {
    expect(
      refusal(
        "SELECT trace_id FROM traces JOIN spans ON traces.trace_id = spans.trace_id",
      ).message,
    ).toMatch(/Joins are not supported/);
  });

  it("refuses INTO OUTFILE", () => {
    expect(
      refusal("SELECT trace_id FROM traces INTO OUTFILE '/tmp/x'").message,
    ).toMatch(/INTO is not supported/);
  });

  it("refuses an unknown function, echoing the caller's spelling", () => {
    const error = refusal("SELECT groupArray(trace_id) FROM traces");
    expect(error.code).toBe("unknown_function");
    expect(error.message).toBe("Unknown function 'groupArray'.");

    // A near miss suggests the real one rather than listing all six.
    expect(refusal("SELECT coumt(*) FROM traces").hint).toBe(
      "Did you mean 'count'?",
    );
  });

  it("refuses an unknown identifier wherever it appears", () => {
    for (const query of [
      "SELECT nonexistent FROM traces",
      "SELECT trace_id FROM traces WHERE nonexistent = 1",
      "SELECT count(*) FROM traces GROUP BY nonexistent",
      "SELECT trace_id FROM traces ORDER BY nonexistent",
      "SELECT max(nonexistent) FROM traces",
    ]) {
      const error = refusal(query);
      expect(error.code, query).toBe("unknown_field");
      expect(error.message, query).toContain("nonexistent");
    }
  });

  it("refuses an unknown entity", () => {
    const error = refusal("SELECT trace_id FROM secrets");
    expect(error.code).toBe("unknown_entity");
    expect(error.message).toBe("Unknown entity 'secrets'.");
  });

  it("refuses clauses the language does not have", () => {
    expect(refusal("SELECT DISTINCT model FROM traces").message).toMatch(
      /DISTINCT/,
    );
    expect(
      refusal(
        "SELECT model, count(*) FROM traces GROUP BY model HAVING count(*) > 1",
      ).message,
    ).toMatch(/HAVING/);
    expect(
      refusal("WITH t AS (SELECT 1) SELECT trace_id FROM traces").message,
    ).toMatch(/WITH/);
    expect(refusal("SELECT count(*) OVER () FROM traces").message).toMatch(
      /Window functions/,
    );
    expect(refusal("SELECT * FROM traces").message).toMatch(
      /SELECT \* is not supported/,
    );
  });

  it("refuses a condition that is not a field compared to a value", () => {
    // `WHERE 1 = 1` is the tautology half of every injection attempt. It has
    // no field to resolve, so it never reaches the catalogue at all.
    expect(refusal("SELECT trace_id FROM traces WHERE 1 = 1").message).toMatch(
      /must start with a field name/,
    );
    expect(
      refusal("SELECT trace_id FROM traces WHERE cost_usd BETWEEN 1 AND 2")
        .message,
    ).toMatch(/'BETWEEN' is not supported/);
    expect(
      refusal("SELECT trace_id FROM traces WHERE model = topic_id").message,
    ).toMatch(/found a column name/);
  });

  it("refuses caller text in an identifier position", () => {
    // Each of these is a way to reach the generated SQL with a string of the
    // caller's choosing rather than a catalogue key.
    expect(
      refusal(`SELECT count(*) AS "not an identifier" FROM traces`).message,
    ).toMatch(/is not a valid alias/);
    expect(refusal(`SELECT "trace_id" FROM traces`).message).toMatch(
      /Quoted column names/,
    );
    expect(refusal("SELECT traces.trace_id FROM traces").message).toMatch(
      /Table-qualified/,
    );
    expect(refusal("SELECT trace_id FROM public.traces").message).toMatch(
      /Schema-qualified/,
    );
    expect(refusal("SELECT trace_id FROM traces t").message).toMatch(
      /Table aliases/,
    );
    expect(
      refusal("SELECT trace_id FROM traces WHERE model = :name").message,
    ).toMatch(/placeholders/);
  });

  it("refuses positional GROUP BY and ORDER BY", () => {
    expect(
      refusal("SELECT model, count(*) FROM traces GROUP BY 1").message,
    ).toMatch(/GROUP BY takes field names/);
    expect(refusal("SELECT trace_id FROM traces ORDER BY 1").message).toMatch(
      /Only fields and aggregates/,
    );
  });
});

describe("bounds", () => {
  it("refuses an empty query", () => {
    expect(refusal("   ").message).toMatch(/Query is empty/);
  });

  it("refuses a query past the length ceiling", () => {
    const padding = "a".repeat(9000);
    expect(
      refusal(`SELECT trace_id FROM traces WHERE topic_id = '${padding}'`)
        .message,
    ).toMatch(/too long/);
  });

  it("refuses a WHERE clause nested past the depth ceiling", () => {
    // Alternating AND/OR so the flattening above cannot collapse it.
    let clause = "has_error = true";
    for (let level = 0; level < 14; level++) {
      const operator = level % 2 === 0 ? "OR" : "AND";
      clause = `span_count > ${level} ${operator} (${clause})`;
    }

    expect(
      refusal(`SELECT trace_id FROM traces WHERE ${clause}`).message,
    ).toMatch(/nested too deeply/);
  });

  it("reports where a syntax error happened", () => {
    const error = refusal("SELECT trace_id FROM traces ORDER BY");
    expect(error.code).toBe("parse_error");
    expect(error.position).toBeGreaterThan(0);
    expect(error.hint).toBeTruthy();
  });

  it("refuses a LIMIT that is not a whole number", () => {
    expect(refusal("SELECT trace_id FROM traces LIMIT 1.5").message).toMatch(
      /LIMIT expects a whole number/,
    );
    expect(refusal("SELECT trace_id FROM traces LIMIT -1").message).toMatch(
      /LIMIT expects a whole number/,
    );
  });
});

/**
 * The LangWatchQL gate, driven through the real ClickHouse parser.
 *
 * Every case here submits SQL text rather than a hand-built tree, so a rule
 * that stops matching what the grammar actually produces turns this red. The
 * synthetic-tree cases — the default-deny fallthrough — live in
 * `failClosed.unit.test.ts`, which is the only place a fake parser appears.
 */
import { describe, expect, it } from "vitest";

import type { Protections } from "../../../../traces/protections";
import { LWQL_VIEW_CATALOG } from "../../catalog/lwqlViews";
import { lwqlAllowedTables, lwqlGatedColumns } from "../../catalog/types";
import { type LangWatchQLValidation, validateLangWatchQL } from "../validate";
import {
  type LangWatchQLViolationCode,
  LWQL_VIOLATION_CODES,
} from "../violations";

/** A catalog with one restricted field, which is the interesting configuration. */
const POLICY = {
  allowedTables: ["analytics.traces", "analytics.spans"],
  gatedColumns: ["body"],
  defaultDatabase: "analytics",
} as const;

/** The same catalog for a caller whose permissions withhold nothing. */
const UNGATED_POLICY = { ...POLICY, gatedColumns: [] as readonly string[] };

function validate(
  sql: string,
  policy: {
    allowedTables: readonly string[];
    gatedColumns: readonly string[];
    defaultDatabase?: string;
    limits?: { maxSubqueryDepth: number; maxNodeDepth: number };
    viewColumns?: Readonly<Record<string, readonly string[]>>;
  } = POLICY,
): LangWatchQLValidation {
  return validateLangWatchQL({ sql, ...policy });
}

/**
 * The violation codes, or an empty list when the query passed.
 *
 * Asserting `toEqual([])` on this rather than `result.ok` on a rejection is
 * what makes a failure legible: the report names the rule that fired.
 */
function codesOf(result: LangWatchQLValidation): LangWatchQLViolationCode[] {
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

describe("validateLangWatchQL", () => {
  describe("given SQL the LangWatchQL API is meant to answer", () => {
    it.each([
      [
        "a projection with a filter",
        "SELECT TraceId FROM traces WHERE Cost > 1",
      ],
      [
        "a common table expression",
        "WITH recent AS (SELECT TraceId, Cost FROM traces) SELECT TraceId FROM recent",
      ],
      [
        "an aggregate with grouping, having and ordering",
        "SELECT Model, count() AS n FROM traces GROUP BY Model HAVING n > 10 ORDER BY n DESC LIMIT 20",
      ],
      [
        "a percentile aggregate",
        "SELECT Model, quantile(0.95)(Duration) AS p95 FROM traces GROUP BY Model",
      ],
      [
        "an inline window function",
        "SELECT Model, avg(Duration) OVER (PARTITION BY Model ORDER BY StartedAt) AS rolling FROM traces",
      ],
      [
        "a named window",
        "SELECT sum(Cost) OVER w FROM traces WINDOW w AS (PARTITION BY Model)",
      ],
      [
        "a UNION ALL",
        "SELECT TraceId FROM traces LIMIT 10 UNION ALL SELECT TraceId FROM spans LIMIT 10",
      ],
      [
        "a join on an equality key",
        "SELECT t.TraceId, s.Name FROM traces AS t INNER JOIN spans AS s ON t.TraceId = s.TraceId",
      ],
      [
        "a scalar subquery",
        "SELECT TraceId, (SELECT max(Duration) FROM spans) AS slowest FROM traces",
      ],
      [
        "an IN subquery",
        "SELECT TraceId FROM traces WHERE TraceId IN (SELECT TraceId FROM spans)",
      ],
      [
        "an EXISTS subquery",
        "SELECT TraceId FROM traces WHERE EXISTS (SELECT 1 FROM spans)",
      ],
      [
        "array, map and JSON access",
        "SELECT Tags[1], Attributes['model'], JSONExtractString(Metadata, 'k') FROM traces",
      ],
      [
        "a lambda over an array",
        "SELECT arrayMap(x -> x * 2, Durations) FROM traces",
      ],
      ["a row count over every row", "SELECT count(*) FROM traces"],
      [
        "DISTINCT with LIMIT BY",
        "SELECT DISTINCT Model FROM traces ORDER BY Model LIMIT 1 BY Model",
      ],
      ["FINAL with a sample", "SELECT TraceId FROM traces FINAL SAMPLE 1/10"],
      [
        "a time-bucketed comparison",
        "WITH b AS (SELECT toStartOfHour(StartedAt) AS bucket, count() AS n FROM traces GROUP BY bucket) SELECT bucket, n FROM b ORDER BY bucket WITH FILL",
      ],
    ])("accepts %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toEqual([]);
    });

    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it("reports the LangWatchQL tables a query reads", () => {
      const result = validate(
        "SELECT t.TraceId FROM traces AS t JOIN analytics.spans AS s ON t.TraceId = s.TraceId",
      );

      expect(result.ok && result.tables).toEqual([
        "analytics.traces",
        "analytics.spans",
      ]);
    });

    it("accepts bound parameters and reports what they declare", () => {
      const result = validate(
        "SELECT TraceId FROM traces WHERE StartedAt > {since:DateTime} AND Cost > {floor:Float64}",
      );

      expect(result.ok && result.parameters).toEqual([
        { name: "since", type: "DateTime" },
        { name: "floor", type: "Float64" },
      ]);
    });

    it("does not count a common table expression as a table reference", () => {
      const result = validate(
        "WITH ledger AS (SELECT Cost FROM traces) SELECT sum(Cost) FROM ledger",
      );

      expect(codesOf(result)).toEqual([]);
      expect(result.ok && result.tables).toEqual(["analytics.traces"]);
    });

    it("accepts a wildcard when the caller has no restricted fields", () => {
      expect(codesOf(validate("SELECT * FROM traces", UNGATED_POLICY))).toEqual(
        [],
      );
    });
  });

  describe("given a statement that is not a read query", () => {
    it.each<[string, string]>([
      ["an insert", "INSERT INTO traces VALUES (1)"],
      ["a create", "CREATE TABLE t (a UInt8) ENGINE = Memory"],
      ["an alter", "ALTER TABLE traces UPDATE Cost = 0 WHERE 1"],
      ["a drop", "DROP TABLE traces"],
      ["a truncate", "TRUNCATE TABLE traces"],
      ["a delete", "DELETE FROM traces WHERE 1"],
      ["an optimize", "OPTIMIZE TABLE traces"],
      ["a grant", "GRANT SELECT ON analytics.traces TO someone"],
      ["a role change", "SET DEFAULT ROLE analyst TO someone"],
      ["an identity change", "EXECUTE AS someone SELECT 1"],
      ["a session setting", "SET max_threads = 1"],
      ["a database switch", "USE analytics"],
      ["a metadata listing", "SHOW TABLES"],
      ["a schema description", "DESCRIBE TABLE traces"],
      ["a plan dump", "EXPLAIN SELECT TraceId FROM traces"],
      ["a query kill", "KILL QUERY WHERE 1"],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toEqual(["STATEMENT_NOT_ALLOWED"]);
    });

    it("refuses two statements in one submission", () => {
      expect(
        codesOf(
          validate("SELECT TraceId FROM traces; SELECT TraceId FROM spans"),
        ),
      ).toEqual(["MULTIPLE_STATEMENTS"]);
    });

    it("refuses text that is not SQL, and says where it stopped", () => {
      const result = validate("SELECT FROM WHERE ((");

      expect(codesOf(result)).toEqual(["PARSE_FAILED"]);
      expect(result.ok || result.violations[0]?.at).toEqual({
        line: expect.any(Number),
        column: expect.any(Number),
      });
    });

    it.each([
      ["nothing at all", ""],
      ["only a comment", "-- just a note"],
    ])("refuses a submission carrying %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toEqual(["EMPTY_QUERY"]);
    });
  });

  describe("given a SETTINGS clause", () => {
    it.each([
      [
        "trailing the statement",
        "SELECT TraceId FROM traces SETTINGS max_threads = 1",
      ],
      [
        "buried in a subquery",
        "SELECT TraceId FROM (SELECT TraceId FROM traces SETTINGS max_threads = 1)",
      ],
      [
        "naming the tenant capability itself",
        "SELECT TraceId FROM traces SETTINGS custom_api_key_hash = 'someone-elses-hash'",
      ],
    ])("refuses one %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("SETTINGS_CLAUSE");
    });
  });

  describe("given a clause that redirects output", () => {
    it.each([
      ["a response format", "SELECT TraceId FROM traces FORMAT JSON"],
      ["a file target", "SELECT TraceId FROM traces INTO OUTFILE '/tmp/leak'"],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("OUTPUT_CLAUSE");
    });
  });

  describe("given a reference to server metadata", () => {
    it.each([
      ["the system schema", "SELECT * FROM system.tables"],
      [
        "the standard information schema",
        "SELECT * FROM information_schema.tables",
      ],
      ["its upper-case spelling", "SELECT * FROM INFORMATION_SCHEMA.tables"],
      ["a quoted system schema", "SELECT * FROM `system`.query_log"],
      [
        "a system table reached through a subquery",
        "SELECT TraceId FROM traces WHERE TraceId IN (SELECT name FROM system.users)",
      ],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("SCHEMA_NOT_ALLOWED");
    });
  });

  describe("given a table outside the caller's catalog", () => {
    it.each([
      ["another database", "SELECT id FROM billing.invoices"],
      [
        "an unlisted table in the LangWatchQL database",
        "SELECT id FROM api_key_map",
      ],
      [
        "a table chosen by a bound parameter",
        "SELECT id FROM {which:Identifier}",
      ],
      [
        "a table whose database is chosen by a bound parameter",
        "SELECT id FROM {db:Identifier}.traces",
      ],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("TABLE_NOT_ALLOWED");
    });

    /**
     * The refusal echoes the identifier the caller wrote, and a backtick-quoted
     * ClickHouse identifier can carry anything — so the echo must shed the
     * characters that would ride an ANSI escape or a bidi override back into
     * terminals and agent logs through `message` and `meta.violations`.
     */
    it("strips control characters and bidi overrides from the echoed name", () => {
      const result = validate(
        "SELECT id FROM `evil\u001b[31m\u202ename\u200b`",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const messages = result.violations.map((violation) => violation.message);
      expect(messages.join(" ")).toContain("evil");
      for (const message of messages) {
        expect(message).not.toMatch(
          /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u,
        );
      }
    });
  });

  describe("given a table function", () => {
    it.each([
      ["url", "SELECT * FROM url('http://169.254.169.254/', CSV)"],
      ["s3", "SELECT * FROM s3('https://bucket/k', 'CSV')"],
      ["remote", "SELECT * FROM remote('other-host', 'db', 'tbl')"],
      ["file", "SELECT * FROM file('/etc/passwd', 'CSV')"],
      [
        "postgresql",
        "SELECT * FROM postgresql('h:5432', 'db', 'tbl', 'u', 'p')",
      ],
      ["cluster", "SELECT * FROM cluster('c', analytics.traces)"],
      ["merge", "SELECT * FROM merge('analytics', '^traces')"],
      ["numbers", "SELECT * FROM numbers(10)"],
      ["view", "SELECT * FROM view(SELECT 1)"],
      ["generateRandom", "SELECT * FROM generateRandom('a UInt8')"],
      [
        "one hidden inside a subquery",
        "SELECT TraceId FROM traces WHERE TraceId IN (SELECT c1 FROM url('http://x', CSV))",
      ],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("TABLE_FUNCTION");
    });
  });

  describe("given a restricted field", () => {
    /**
     * One case per expression position the content-gating policy enumerates.
     * The `clause` assertion is what stops this collapsing into eight copies of
     * "somewhere": a walk that reached the reference by the wrong route, or by
     * no route at all, cannot report the right one.
     */
    it.each<[string, string, string]>([
      ["projection", "SELECT body FROM traces", "projection"],
      ["filter", "SELECT TraceId FROM traces WHERE body != ''", "filter"],
      ["group", "SELECT count() FROM traces GROUP BY body", "group"],
      ["order", "SELECT TraceId FROM traces ORDER BY body", "order"],
      [
        "having",
        "SELECT TraceId, count() AS n FROM traces GROUP BY TraceId HAVING max(body) != ''",
        "having",
      ],
      [
        "join",
        "SELECT t.TraceId FROM traces AS t JOIN spans AS s ON t.body = s.TraceId",
        "join",
      ],
      [
        "window",
        "SELECT count() OVER (PARTITION BY body) FROM traces",
        "window",
      ],
      [
        "subquery",
        "SELECT TraceId FROM traces WHERE TraceId IN (SELECT body FROM spans)",
        "subquery",
      ],
    ])("refuses one referenced in %s position", (_position, sql, clause) => {
      const result = validate(sql);

      expect(codesOf(result)).toContain("GATED_COLUMN");
      expect(
        result.ok
          ? []
          : result.violations
              .filter((violation) => violation.code === "GATED_COLUMN")
              .map((violation) => violation.clause),
      ).toContain(clause);
    });

    it("refuses one reached through a table alias", () => {
      expect(codesOf(validate("SELECT t.body FROM traces AS t"))).toContain(
        "GATED_COLUMN",
      );
    });

    /**
     * The field name is deliberately one the policy permits: a parameter in
     * identifier position is refused because its value arrives after the gate
     * has run, so the only thing that can produce a violation here is the
     * parameter itself.
     */
    it("refuses a field named by a bound parameter in identifier position", () => {
      expect(
        codesOf(validate("SELECT {which:Identifier}.TraceId FROM traces")),
      ).toEqual(["GATED_COLUMN"]);
    });

    /**
     * The case above binds the *qualifier* and left the one that mattered
     * uncovered: a parameter standing in for the column itself. Measured
     * against a live instance, `SELECT {c:Identifier}` returned a withheld
     * value that `SELECT <that column>` refuses — the reference never reaches
     * the walk, so the gate has nothing to match and ClickHouse substitutes
     * the name after every check has passed.
     *
     * The bound-identifier SQL is the same on every iteration on purpose: the
     * parameter shape is refused regardless of which column it would resolve
     * to, since the reference never reaches the walk. What varies per gated
     * column is the control — the literal spelling of that column staying
     * refused is what keeps the refusal above about the shape rather than
     * about a gate that quietly stopped working.
     */
    it.each(
      POLICY.gatedColumns,
    )("refuses a parameter standing in for the withheld column %s", (gated) => {
      const bound = codesOf(validate("SELECT {c:Identifier} FROM traces"));
      expect(
        bound,
        "a bound identifier reached the column position ungated",
      ).not.toEqual([]);
      // The literal spelling is the control: if this stopped being refused,
      // the case above would pass for the wrong reason.
      expect(codesOf(validate(`SELECT ${gated} FROM traces`))).toContain(
        "GATED_COLUMN",
      );
    });

    it.each([
      ["a projection", "SELECT {c:Identifier} FROM traces"],
      ["a filter", "SELECT TraceId FROM traces WHERE {c:Identifier} = 'x'"],
      ["a grouping key", "SELECT count() FROM traces GROUP BY {c:Identifier}"],
      ["an ordering key", "SELECT TraceId FROM traces ORDER BY {c:Identifier}"],
      ["a table name", "SELECT count() FROM {t:Identifier}"],
    ])("refuses an identifier-typed parameter used as %s", (_position, sql) => {
      expect(codesOf(validate(sql)), sql).not.toEqual([]);
    });

    it.each([
      ["a bare wildcard", "SELECT * FROM traces"],
      ["a qualified wildcard", "SELECT t.* FROM traces AS t"],
      ["a wildcard minus a column", "SELECT * EXCEPT (Cost) FROM traces"],
      [
        "a regular-expression column set",
        "SELECT COLUMNS('^Trace') FROM traces",
      ],
    ])("refuses %s, whose members it cannot enumerate", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("WILDCARD_NOT_ALLOWED");
    });

    it("still refuses a restricted field named inside an explicit column set", () => {
      expect(
        codesOf(validate("SELECT COLUMNS(TraceId, body) FROM traces")),
      ).toContain("GATED_COLUMN");
    });
  });

  /**
   * A column set does not become resolvable by being wrapped in a function or
   * buried in a clause, so the gate refuses it wherever it appears — not only as
   * a direct projection element. The one exemption is a bare `count(*)`, where
   * the star names a row count and reveals no column.
   */
  describe("given a column set outside the projection", () => {
    const regexPositions: ReadonlyArray<[string, (matcher: string) => string]> =
      [
        [
          "a function argument",
          (m) => `SELECT toString(${m}) FROM traces AS t`,
        ],
        ["WHERE", (m) => `SELECT t.TraceId FROM traces AS t WHERE ${m} = 1`],
        ["GROUP BY", (m) => `SELECT count() FROM traces AS t GROUP BY ${m}`],
        [
          "HAVING",
          (m) =>
            `SELECT t.TraceId, count() AS n FROM traces AS t GROUP BY t.TraceId HAVING ${m} > 0`,
        ],
        ["ORDER BY", (m) => `SELECT t.TraceId FROM traces AS t ORDER BY ${m}`],
        [
          "LIMIT BY",
          (m) =>
            `SELECT t.TraceId FROM traces AS t ORDER BY t.TraceId LIMIT 1 BY ${m}`,
        ],
        [
          "JOIN ON",
          (m) =>
            `SELECT t.TraceId FROM traces AS t JOIN spans AS s ON ${m} = s.TraceId`,
        ],
        [
          "a window PARTITION BY",
          (m) => `SELECT count() OVER (PARTITION BY ${m}) FROM traces AS t`,
        ],
        [
          "a lambda body",
          (m) => `SELECT arrayMap(x -> toString(${m}), [1]) FROM traces AS t`,
        ],
        [
          "a CTE body",
          (m) =>
            `WITH c AS (SELECT ${m} FROM traces AS t) SELECT TraceId FROM c`,
        ],
        [
          "a subquery",
          (m) =>
            `SELECT TraceId FROM traces WHERE TraceId IN (SELECT ${m} FROM spans AS t)`,
        ],
        [
          "a UNION ALL branch",
          (m) =>
            `SELECT TraceId FROM traces LIMIT 10 UNION ALL SELECT ${m} FROM spans AS t LIMIT 10`,
        ],
      ];
    const regexMatchers = ["COLUMNS('^Trace')", "t.COLUMNS('^Trace')"];
    const regexCases: Array<[string, string]> = regexPositions.flatMap(
      ([where, build]) =>
        regexMatchers.map((matcher): [string, string] => [
          `${matcher} in ${where}`,
          build(matcher),
        ]),
    );

    /** @scenario "A regular-expression column set is refused wherever it appears" */
    it.each(regexCases)("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("WILDCARD_NOT_ALLOWED");
    });

    const wildcardCases: Array<[string, string]> = [
      ["tuple(*)", "SELECT tuple(*) FROM traces"],
      [
        "tupleElement(tuple(*), 1)",
        "SELECT tupleElement(tuple(*), 1) FROM traces",
      ],
      ["tuple(t.*)", "SELECT tuple(t.*) FROM traces AS t"],
      [
        "tuple(* EXCEPT (TraceId))",
        "SELECT tuple(* EXCEPT (TraceId)) FROM traces",
      ],
      [
        "tuple(* REPLACE (1 AS TraceId))",
        "SELECT tuple(* REPLACE (1 AS TraceId)) FROM traces",
      ],
      ["toString(*)", "SELECT toString(*) FROM traces"],
      [
        "concat('', COLUMNS('^Trace'))",
        "SELECT concat('', COLUMNS('^Trace')) FROM traces",
      ],
      ["GROUP BY *", "SELECT count() FROM traces GROUP BY *"],
      ["ORDER BY t.*", "SELECT t.TraceId FROM traces AS t ORDER BY t.*"],
      ["* APPLY (toString)", "SELECT * APPLY (toString) FROM traces"],
      [
        "COLUMNS('^Trace') APPLY (toString)",
        "SELECT COLUMNS('^Trace') APPLY (toString) FROM traces",
      ],
      [
        "a named WINDOW partitioned by a matcher",
        "SELECT count(*) OVER w FROM traces WINDOW w AS (PARTITION BY COLUMNS('^bo'))",
      ],
      [
        "COLUMNS('body', 'TraceId') with string-literal members",
        "SELECT COLUMNS('body', 'TraceId') FROM traces",
      ],
      [
        "t.COLUMNS('body', 'TraceId') with string-literal members",
        "SELECT t.COLUMNS('body', 'TraceId') FROM traces AS t",
      ],
      [
        "COLUMNS(TraceId, 'body') with a mixed member list",
        "SELECT COLUMNS(TraceId, 'body') FROM traces",
      ],
    ];

    /** @scenario "A wildcard is refused inside functions and in non-projection clauses" */
    it.each(wildcardCases)("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("WILDCARD_NOT_ALLOWED");
    });

    /** @scenario "Only a bare star as the sole argument of count stays exempt" */
    it.each([
      ["count(*)", "SELECT count(*) FROM traces"],
      ["count()", "SELECT count() FROM traces"],
      ["count(*) OVER ()", "SELECT count(*) OVER () FROM traces"],
    ])("accepts %s as a row count", (_case, sql) => {
      expect(codesOf(validate(sql))).toEqual([]);
    });

    /** @scenario "Only a bare star as the sole argument of count stays exempt" */
    it.each([
      ["count(t.*)", "SELECT count(t.*) FROM traces AS t"],
      ["count(DISTINCT *)", "SELECT count(DISTINCT *) FROM traces"],
      [
        "count(* EXCEPT (TraceId))",
        "SELECT count(* EXCEPT (TraceId)) FROM traces",
      ],
      ["count(*, TraceId)", "SELECT count(*, TraceId) FROM traces"],
      ["sum(*)", "SELECT sum(*) FROM traces"],
      ["count(tuple(*))", "SELECT count(tuple(*)) FROM traces"],
      [
        "count(*) OVER (PARTITION BY COLUMNS('^bo'))",
        "SELECT count(*) OVER (PARTITION BY COLUMNS('^bo')) FROM traces",
      ],
      [
        "count(*) OVER (PARTITION BY *)",
        "SELECT count(*) OVER (PARTITION BY *) FROM traces",
      ],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("WILDCARD_NOT_ALLOWED");
    });

    /** @scenario "A caller with nothing withheld keeps every column-set shape" */
    it.each([
      ...regexCases,
      ...wildcardCases,
    ])("accepts %s when the caller has no restricted fields", (_case, sql) => {
      expect(codesOf(validate(sql, UNGATED_POLICY))).toEqual([]);
    });

    /** @scenario "A qualified path through a gated column is refused" */
    it.each([
      [
        "a subfield of the gated column",
        "SELECT TraceId, body.null FROM traces",
      ],
      [
        "a table-qualified path through it",
        "SELECT traces.body.null FROM traces",
      ],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("GATED_COLUMN");
    });

    /** @scenario "A qualified path through a gated column is refused" */
    it.each([
      [
        "a subfield of the gated column",
        "SELECT TraceId, body.null FROM traces",
      ],
      [
        "a table-qualified path through it",
        "SELECT traces.body.null FROM traces",
      ],
      [
        "an alias-qualified path through it",
        "SELECT t.body.null FROM traces AS t",
      ],
    ])("still names the view and its usable columns for %s", (_case, sql) => {
      const result = validate(sql, {
        ...POLICY,
        viewColumns: { "analytics.traces": ["TraceId", "Cost", "body"] },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "GATED_COLUMN",
      );
      expect(violation?.view).toBe("analytics.traces");
      expect(violation?.availableColumns).toEqual(["Cost", "TraceId"]);
    });

    /** @scenario "A COLUMNS() list that names every member is gated member by member" */
    it("accepts COLUMNS(TraceId) and refuses COLUMNS(body) by the named field", () => {
      expect(codesOf(validate("SELECT COLUMNS(TraceId) FROM traces"))).toEqual(
        [],
      );
      expect(codesOf(validate("SELECT COLUMNS(body) FROM traces"))).toEqual([
        "GATED_COLUMN",
      ]);
    });
  });

  describe("given nesting past the configured depth", () => {
    const limitedTo = (maxSubqueryDepth: number) => ({
      ...UNGATED_POLICY,
      limits: { maxSubqueryDepth, maxNodeDepth: 400 },
    });

    it("accepts a subquery nest exactly at the limit", () => {
      expect(
        codesOf(
          validate(
            "SELECT TraceId FROM (SELECT TraceId FROM (SELECT TraceId FROM traces))",
            limitedTo(2),
          ),
        ),
      ).toEqual([]);
    });

    it("refuses a subquery nest one level past the limit", () => {
      expect(
        codesOf(
          validate(
            "SELECT TraceId FROM (SELECT TraceId FROM (SELECT TraceId FROM (SELECT TraceId FROM traces)))",
            limitedTo(2),
          ),
        ),
      ).toContain("NESTING_TOO_DEEP");
    });

    it("counts common table expressions towards the same ceiling", () => {
      expect(
        codesOf(
          validate(
            "WITH a AS (SELECT TraceId FROM (SELECT TraceId FROM (SELECT TraceId FROM traces))) SELECT TraceId FROM a",
            limitedTo(2),
          ),
        ),
      ).toContain("NESTING_TOO_DEEP");
    });

    it("refuses a tree deeper than the walk will descend", () => {
      expect(
        codesOf(
          validate("SELECT ((((((TraceId)))))) FROM traces", {
            ...UNGATED_POLICY,
            limits: { maxSubqueryDepth: 8, maxNodeDepth: 4 },
          }),
        ),
      ).toContain("NESTING_TOO_DEEP");
    });
  });

  describe("given a join shape the LangWatchQL schema does not define", () => {
    it("refuses a positional PASTE join", () => {
      expect(
        codesOf(validate("SELECT TraceId FROM traces PASTE JOIN spans")),
      ).toContain("UNSUPPORTED_SYNTAX");
    });
  });

  describe("given a violation whose refusal should name what exists", () => {
    /** @scenario "A TABLE_NOT_ALLOWED violation names the views that exist" */
    it("lists the caller's allowed views on an unknown view", () => {
      const result = validate("SELECT id FROM billing.invoices");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "TABLE_NOT_ALLOWED",
      );
      expect(violation?.availableViews).toEqual([
        "analytics.spans",
        "analytics.traces",
      ]);
    });

    /** @scenario "A TABLE_NOT_ALLOWED violation names the views that exist" */
    it("sorts and deduplicates availableViews regardless of the policy's own order", () => {
      const result = validate("SELECT id FROM billing.invoices", {
        allowedTables: [
          "analytics.traces",
          "analytics.spans",
          "analytics.traces",
        ],
        gatedColumns: [],
        defaultDatabase: "analytics",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "TABLE_NOT_ALLOWED",
      );
      expect(violation?.availableViews).toEqual([
        "analytics.spans",
        "analytics.traces",
      ]);
    });

    /**
     * The bound-parameter TABLE_NOT_ALLOWED names no view to correct — it
     * still gets a hint, but never a stale/irrelevant view list.
     */
    it("omits availableViews when no view name was written", () => {
      const result = validate("SELECT id FROM {which:Identifier}");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "TABLE_NOT_ALLOWED",
      );
      expect(violation?.availableViews).toBeUndefined();
      expect(violation?.hint).toBeTruthy();
    });

    /** @scenario "A GATED_COLUMN violation names the view's columns" */
    it("names the view and its columns on a gated field read through an alias", () => {
      const result = validate("SELECT t.body FROM traces AS t", {
        ...POLICY,
        viewColumns: {
          "analytics.traces": ["TraceId", "Cost", "body"],
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "GATED_COLUMN",
      );
      expect(violation?.view).toBe("analytics.traces");
      // The gated field is not offered back as a suggestion.
      expect(violation?.availableColumns).toEqual(["Cost", "TraceId"]);
    });

    /** @scenario "A GATED_COLUMN violation names the view's columns" */
    it("resolves the view from the sole table in scope when the reference is unqualified", () => {
      const result = validate("SELECT body FROM traces", {
        ...POLICY,
        viewColumns: { "analytics.traces": ["TraceId", "body"] },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "GATED_COLUMN",
      );
      expect(violation?.view).toBe("analytics.traces");
    });

    it("does not guess a view for an unqualified gated field with two tables in scope", () => {
      const result = validate(
        "SELECT body FROM traces JOIN spans ON traces.TraceId = spans.TraceId",
        { ...POLICY, viewColumns: { "analytics.traces": ["body"] } },
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "GATED_COLUMN",
      );
      expect(violation?.view).toBeUndefined();
      expect(violation?.availableColumns).toBeUndefined();
      // Still not left with nothing to act on.
      expect(violation?.hint).toBeTruthy();
    });

    it("omits availableColumns when the policy carries no column data for the view", () => {
      const result = validate("SELECT body FROM traces");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "GATED_COLUMN",
      );
      expect(violation?.view).toBe("analytics.traces");
      expect(violation?.availableColumns).toBeUndefined();
    });

    /**
     * One SQL text per violation code, driven through the real validator —
     * the exhaustiveness this asserts is that every code a real query can
     * trigger comes back with a hint, not that the internal lookup table
     * happens to have every key (which the compiler already guarantees: it
     * types that table as `Record<LangWatchQLViolationCode, string>`).
     */
    /** @scenario "Every violation carries a corrective hint" */
    it.each([
      ["EMPTY_QUERY", ""],
      ["PARSE_FAILED", "SELECT FROM WHERE (("],
      [
        "MULTIPLE_STATEMENTS",
        "SELECT TraceId FROM traces; SELECT TraceId FROM spans",
      ],
      ["STATEMENT_NOT_ALLOWED", "INSERT INTO traces VALUES (1)"],
      [
        "SETTINGS_CLAUSE",
        "SELECT TraceId FROM traces SETTINGS max_threads = 1",
      ],
      ["OUTPUT_CLAUSE", "SELECT TraceId FROM traces FORMAT JSON"],
      ["SCHEMA_NOT_ALLOWED", "SELECT * FROM system.tables"],
      ["TABLE_NOT_ALLOWED", "SELECT id FROM billing.invoices"],
      ["TABLE_FUNCTION", "SELECT * FROM url('http://x', CSV)"],
      ["FUNCTION_NOT_ALLOWED", "SELECT unsupportedFn(TraceId) FROM traces"],
      ["GATED_COLUMN", "SELECT body FROM traces"],
      ["WILDCARD_NOT_ALLOWED", "SELECT * FROM traces"],
      ["LIMIT_TOO_HIGH", "SELECT TraceId FROM traces LIMIT 10001"],
      ["NESTING_TOO_DEEP", "SELECT ((((((TraceId)))))) FROM traces"],
      ["UNSUPPORTED_SYNTAX", "SELECT TraceId FROM traces PASTE JOIN spans"],
      [
        "APP_FUNCTION_POSITION",
        "SELECT TraceId FROM traces WHERE thread_traces(ConversationId) = 'x'",
      ],
      [
        "APP_FUNCTION_NAME_CASE",
        "SELECT THREAD_TRACES(ConversationId) AS ids FROM traces",
      ],
      [
        "APP_FUNCTION_ALIAS_REQUIRED",
        "SELECT thread_traces(ConversationId) FROM traces",
      ],
      ["APP_FUNCTION_ARGUMENT", "SELECT thread_traces() AS ids FROM traces"],
      [
        "APP_FUNCTION_GATED",
        "SELECT conversation(ConversationId) AS transcript FROM traces",
      ],
    ] as [
      LangWatchQLViolationCode,
      string,
    ][])("names a hint for %s", (code, sql) => {
      const policy =
        code === "NESTING_TOO_DEEP"
          ? {
              ...UNGATED_POLICY,
              limits: { maxSubqueryDepth: 8, maxNodeDepth: 4 },
            }
          : POLICY;
      const result = validate(sql, policy);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find((entry) => entry.code === code);
      expect(violation, code).toBeDefined();
      expect(violation?.hint, code).toBeTruthy();
    });

    /** Belt-and-suspenders: every code named by the type is covered above. */
    it("covers every violation code with a hint case", () => {
      const covered = new Set<LangWatchQLViolationCode>([
        "EMPTY_QUERY",
        "PARSE_FAILED",
        "MULTIPLE_STATEMENTS",
        "STATEMENT_NOT_ALLOWED",
        "SETTINGS_CLAUSE",
        "OUTPUT_CLAUSE",
        "SCHEMA_NOT_ALLOWED",
        "TABLE_NOT_ALLOWED",
        "TABLE_FUNCTION",
        "FUNCTION_NOT_ALLOWED",
        "GATED_COLUMN",
        "WILDCARD_NOT_ALLOWED",
        "LIMIT_TOO_HIGH",
        "LIMIT_REQUIRED_PER_BRANCH",
        "NESTING_TOO_DEEP",
        "UNSUPPORTED_SYNTAX",
        "APP_FUNCTION_POSITION",
        "APP_FUNCTION_NAME_CASE",
        "APP_FUNCTION_ALIAS_REQUIRED",
        "APP_FUNCTION_ARGUMENT",
        "APP_FUNCTION_GATED",
      ]);
      expect([...covered].sort()).toEqual([...LWQL_VIOLATION_CODES].sort());
    });

    /** @scenario "Every violation carries a corrective hint" */
    it("carries a hint alongside FUNCTION_NOT_ALLOWED's allowedFunctions, not instead of it", () => {
      const result = validate("SELECT unsupportedFn(TraceId) FROM traces");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      const violation = result.violations.find(
        (entry) => entry.code === "FUNCTION_NOT_ALLOWED",
      );
      expect(violation?.hint).toBeTruthy();
      expect(violation?.allowedFunctions).toBeDefined();
    });
  });

  describe("given a query that breaks several rules at once", () => {
    it("reports each of them, so one round trip is enough to fix it", () => {
      const result = validate(
        "SELECT body FROM system.tables SETTINGS max_threads = 1",
      );

      expect(new Set(codesOf(result))).toEqual(
        new Set(["GATED_COLUMN", "SCHEMA_NOT_ALLOWED", "SETTINGS_CLAUSE"]),
      );
    });
  });

  /**
   * The structural facts a diagnostic reads back off an accepted query. They
   * are recorded by the same walk that validated it, so a case here is also a
   * check that the walk saw the query the way a reader will assume it did.
   */
  describe("given an accepted query whose shape a diagnostic will read", () => {
    const blocksOf = (sql: string) => {
      const result = validate(sql, UNGATED_POLICY);
      if (!result.ok) {
        throw new Error(
          `fixture SQL was refused: ${result.violations.map((v) => v.code).join(", ")}`,
        );
      }
      return result.blocks;
    };

    it("records the views a block reads, with the aliases it gave them", () => {
      expect(
        blocksOf(
          "SELECT t.TraceId FROM traces AS t JOIN analytics.spans AS s ON t.TraceId = s.TraceId",
        )[0]?.tables,
      ).toEqual([
        { table: "analytics.traces", alias: "t" },
        { table: "analytics.spans", alias: "s" },
      ]);
    });

    it("omits an alias a block did not give", () => {
      expect(blocksOf("SELECT TraceId FROM traces")[0]?.tables).toEqual([
        { table: "analytics.traces" },
      ]);
    });

    it("records every key pair an ON condition conjoins", () => {
      expect(
        blocksOf(
          "SELECT t.TraceId FROM traces AS t JOIN spans AS s " +
            "ON t.TenantId = s.TenantId AND t.TraceId = s.TraceId",
        )[0]?.joins,
      ).toEqual(
        expect.arrayContaining([
          { left: "t.TenantId", right: "s.TenantId" },
          { left: "t.TraceId", right: "s.TraceId" },
        ]),
      );
    });

    it("records a USING join as the same column on both sides", () => {
      expect(
        blocksOf("SELECT TraceId FROM traces JOIN spans USING (TraceId)")[0]
          ?.joins,
      ).toEqual([{ left: "TraceId", right: "TraceId" }]);
    });

    /**
     * An equality that only holds on one arm of an `OR` is not a key the join
     * matched on, and neither is one over a computed value. Recording either
     * would tell a fanout rule two views line up when they may not.
     */
    it.each([
      [
        "one arm of an OR",
        "SELECT t.TraceId FROM traces AS t JOIN spans AS s ON t.TraceId = s.TraceId OR t.TenantId = s.TenantId",
      ],
      [
        "a comparison of computed values",
        "SELECT t.TraceId FROM traces AS t JOIN spans AS s ON lower(t.TraceId) = lower(s.TraceId)",
      ],
    ])("records no key pair for %s", (_case, sql) => {
      expect(blocksOf(sql)[0]?.joins).toEqual([]);
    });

    it.each<[string, string, { hasGroupBy: boolean; isAggregated: boolean }]>([
      [
        "a plain projection",
        "SELECT TraceId FROM traces",
        { hasGroupBy: false, isAggregated: false },
      ],
      [
        "an explicit grouping",
        "SELECT Model, count() FROM traces GROUP BY Model",
        { hasGroupBy: true, isAggregated: true },
      ],
      [
        "GROUP BY ALL",
        "SELECT Model, count() FROM traces GROUP BY ALL",
        { hasGroupBy: true, isAggregated: true },
      ],
      [
        "an aggregate with no grouping",
        "SELECT count() FROM traces",
        { hasGroupBy: false, isAggregated: true },
      ],
      [
        "a conditional aggregate",
        "SELECT countIf(Cost > 1) FROM traces",
        { hasGroupBy: false, isAggregated: true },
      ],
      // A window function reads a frame and returns a value per row, so it
      // collapses nothing — the distinction a fanout rule turns on.
      [
        "an aggregate used as a window function",
        "SELECT sum(Cost) OVER (PARTITION BY Model) FROM traces",
        { hasGroupBy: false, isAggregated: false },
      ],
      [
        "a named window over an aggregate",
        "SELECT sum(Cost) OVER w FROM traces WINDOW w AS (PARTITION BY Model)",
        { hasGroupBy: false, isAggregated: false },
      ],
    ])("reports the shape of %s", (_case, sql, expected) => {
      expect(blocksOf(sql)[0]).toMatchObject(expected);
    });

    it("gives every SELECT its own block, outermost first", () => {
      const blocks = blocksOf(
        "SELECT TraceId FROM (SELECT TraceId FROM traces GROUP BY TraceId)",
      );

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({ tables: [], hasGroupBy: false });
      expect(blocks[1]).toMatchObject({
        tables: [{ table: "analytics.traces" }],
        hasGroupBy: true,
      });
    });

    it("keeps a common table expression's aggregation out of the block that reads it", () => {
      const blocks = blocksOf(
        "WITH totals AS (SELECT TraceId, sum(Cost) AS spend FROM traces GROUP BY TraceId) " +
          "SELECT TraceId, spend FROM totals",
      );

      expect(
        blocks.some((block) => block.hasGroupBy && block.isAggregated),
      ).toBe(true);
      const outermost = blocks[0];
      expect(outermost).toMatchObject({
        tables: [],
        hasGroupBy: false,
        isAggregated: false,
      });
    });

    it("gives each branch of a UNION its own block", () => {
      const blocks = blocksOf(
        "SELECT TraceId FROM traces LIMIT 10 UNION ALL SELECT count() FROM spans LIMIT 10",
      );

      expect(blocks.map((block) => block.isAggregated)).toEqual([false, true]);
    });
  });

  describe("given the row cap on what one request returns", () => {
    /** @scenario "A statement with no LIMIT is capped at the row ceiling" */
    it("flags a statement that names no LIMIT for the default cap to be appended", () => {
      const result = validate("SELECT TraceId FROM traces WHERE Cost > 1");
      expect(result.ok && result.appendRowLimit).toBe(true);
    });

    it("leaves a statement that already names a LIMIT alone", () => {
      const result = validate("SELECT TraceId FROM traces LIMIT 20");
      expect(result.ok && result.appendRowLimit).toBe(false);
    });

    it("leaves a statement that pages with OFFSET alone", () => {
      const result = validate(
        "SELECT TraceId FROM traces ORDER BY TraceId LIMIT 20 OFFSET 40",
      );
      expect(result.ok && result.appendRowLimit).toBe(false);
    });

    it("accepts a LIMIT at exactly the cap without flagging an append", () => {
      const result = validate("SELECT TraceId FROM traces LIMIT 10000");
      expect(codesOf(result)).toEqual([]);
      expect(result.ok && result.appendRowLimit).toBe(false);
    });

    /** @scenario "A LIMIT above the ceiling is refused before the query runs" */
    it("refuses a LIMIT above the cap, naming the cap and how to page", () => {
      const result = validate("SELECT TraceId FROM traces LIMIT 10001");
      expect(codesOf(result)).toEqual(["LIMIT_TOO_HIGH"]);
      const violation = !result.ok
        ? result.violations.find((v) => v.code === "LIMIT_TOO_HIGH")
        : undefined;
      expect(violation?.maxRows).toBe(10000);
      expect(violation?.clause).toBe("limit");
      expect(violation?.hint).toMatch(/LIMIT\/OFFSET/);
    });

    it("does not refuse a LIMIT whose value is a bound parameter", () => {
      const result = validate("SELECT TraceId FROM traces LIMIT {n:UInt32}");
      expect(codesOf(result)).toEqual([]);
      // A dynamic LIMIT is treated as present, so the default cap is not appended.
      expect(result.ok && result.appendRowLimit).toBe(false);
    });

    it("refuses a UNION branch whose own LIMIT is over the cap", () => {
      const result = validate(
        "SELECT TraceId FROM traces LIMIT 5 " +
          "UNION ALL SELECT TraceId FROM spans LIMIT 99999",
      );
      expect(codesOf(result)).toEqual(["LIMIT_TOO_HIGH"]);
    });

    /** @scenario "An OFFSET with no LIMIT is still unbounded" */
    it("flags a statement that names only OFFSET for the default cap to be appended", () => {
      const result = validate("SELECT TraceId FROM traces OFFSET 40");
      expect(codesOf(result)).toEqual([]);
      expect(result.ok && result.appendRowLimit).toBe(true);
      expect(result.ok && result.appendRowLimitBeforeOffset).toBeDefined();
    });

    it("accepts the offset,count form of LIMIT as an explicit LIMIT", () => {
      const result = validate("SELECT TraceId FROM traces LIMIT 5, 10");
      expect(codesOf(result)).toEqual([]);
      expect(result.ok && result.appendRowLimit).toBe(false);
    });

    it("refuses the offset,count form when the count is over the cap", () => {
      const result = validate("SELECT TraceId FROM traces LIMIT 5, 99999");
      expect(codesOf(result)).toEqual(["LIMIT_TOO_HIGH"]);
    });

    it("flags a statement that names only LIMIT BY for the default cap to be appended", () => {
      const result = validate("SELECT TraceId FROM traces LIMIT 1 BY TraceId");
      expect(codesOf(result)).toEqual([]);
      // LIMIT BY caps rows per group, not the response, so it does not count
      // as an explicit LIMIT — the statement is still unbounded overall.
      expect(result.ok && result.appendRowLimit).toBe(true);
    });

    /** @scenario "A UNION cannot rely on the default cap" */
    it("refuses a UNION where one branch names no LIMIT at all", () => {
      const result = validate(
        "SELECT TraceId FROM traces LIMIT 1 " +
          "UNION ALL SELECT TraceId FROM spans",
      );
      expect(codesOf(result)).toEqual(["LIMIT_REQUIRED_PER_BRANCH"]);
    });

    it("accepts a UNION where every branch names its own bounded LIMIT", () => {
      const result = validate(
        "SELECT TraceId FROM traces LIMIT 5 " +
          "UNION ALL SELECT TraceId FROM spans LIMIT 5",
      );
      expect(codesOf(result)).toEqual([]);
      expect(result.ok && result.appendRowLimit).toBe(false);
    });

    it("does not refuse a UNION branch whose LIMIT is a bound parameter", () => {
      const result = validate(
        "SELECT TraceId FROM traces LIMIT {n:UInt32} " +
          "UNION ALL SELECT TraceId FROM spans LIMIT 5",
      );
      expect(codesOf(result)).toEqual([]);
    });
  });

  /**
   * Gated means refused, not dropped: the shipped catalog's `annotations`
   * view carries `Comment` (`Annotation.comment`, gated `output` by the
   * derivation) rather than omitting it, so a caller without content access
   * learns the column exists and why it was refused instead of the query
   * silently returning fewer columns than it asked for.
   */
  describe("given the shipped catalog's content gates", () => {
    const database = "analytics";

    function policyFor(protections: Protections) {
      return {
        allowedTables: lwqlAllowedTables({
          database,
          views: LWQL_VIEW_CATALOG,
        }),
        gatedColumns: lwqlGatedColumns({
          protections,
          views: LWQL_VIEW_CATALOG,
        }),
        defaultDatabase: database,
      };
    }

    /** @scenario "A content column is gated, not dropped" */
    it("refuses Comment on annotations without content access, and allows it with", () => {
      const withoutContentAccess: Protections = {
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        canSeeCosts: true,
      };
      const withContentAccess: Protections = {
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
        canSeeCosts: true,
      };

      const refused = validateLangWatchQL({
        sql: `SELECT Comment FROM ${database}.annotations`,
        ...policyFor(withoutContentAccess),
      });
      expect(codesOf(refused)).toContain("GATED_COLUMN");

      const permitted = validateLangWatchQL({
        sql: `SELECT Comment FROM ${database}.annotations`,
        ...policyFor(withContentAccess),
      });
      expect(codesOf(permitted)).toEqual([]);
    });
  });
});

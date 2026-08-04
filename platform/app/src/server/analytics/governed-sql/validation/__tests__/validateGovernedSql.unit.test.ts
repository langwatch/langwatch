/**
 * The governed-SQL gate, driven through the real ClickHouse parser.
 *
 * Every case here submits SQL text rather than a hand-built tree, so a rule
 * that stops matching what the grammar actually produces turns this red. The
 * synthetic-tree cases — the default-deny fallthrough — live in
 * `failClosed.unit.test.ts`, which is the only place a fake parser appears.
 */
import { describe, expect, it } from "vitest";

import { type GovernedSqlValidation, validateGovernedSql } from "../validate";
import type { GovernedSqlViolationCode } from "../violations";

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
  } = POLICY,
): GovernedSqlValidation {
  return validateGovernedSql({ sql, ...policy });
}

/**
 * The violation codes, or an empty list when the query passed.
 *
 * Asserting `toEqual([])` on this rather than `result.ok` on a rejection is
 * what makes a failure legible: the report names the rule that fired.
 */
function codesOf(result: GovernedSqlValidation): GovernedSqlViolationCode[] {
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

describe("validateGovernedSql", () => {
  describe("given SQL the governed API is meant to answer", () => {
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
        "SELECT TraceId FROM traces UNION ALL SELECT TraceId FROM spans",
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
    it("reports the governed tables a query reads", () => {
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
        "an unlisted table in the governed database",
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

  describe("given a join shape the governed schema does not define", () => {
    it("refuses a positional PASTE join", () => {
      expect(
        codesOf(validate("SELECT TraceId FROM traces PASTE JOIN spans")),
      ).toContain("UNSUPPORTED_SYNTAX");
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

    it("records the datasets a block reads, with the aliases it gave them", () => {
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
     * would tell a fanout rule two datasets line up when they may not.
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
        "SELECT TraceId FROM traces UNION ALL SELECT count() FROM spans",
      );

      expect(blocks.map((block) => block.isAggregated)).toEqual([false, true]);
    });
  });
});

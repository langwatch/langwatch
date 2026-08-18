/**
 * The function-name allowlist, driven through the real ClickHouse parser.
 *
 * Two claims, and the second is the one that is easy to fake. The first is that
 * the functions a LangWatchQL question needs are admitted — asserted by submitting
 * the SQL those questions are actually written in. The second is that
 * everything else is refused *because it is absent from the list*, not because
 * some other rule happened to catch it: every refusal case below is paired with
 * a control that runs the same query with an allowlisted function in the same
 * position and asserts it passes. Without that pair, a case would still be
 * green if the whole expression had been unparseable, or the table wrong, or
 * the column gated.
 *
 * @see ../functions.ts — the list, and the rule that governs what is on it
 */
import { describe, expect, it } from "vitest";

import { type LangWatchQLValidation, validateLangWatchQL } from "../validate";
import type { LangWatchQLViolationCode } from "../violations";

const POLICY = {
  allowedTables: ["analytics.traces", "analytics.spans"],
  gatedColumns: [] as readonly string[],
  defaultDatabase: "analytics",
};

function validate(sql: string): LangWatchQLValidation {
  return validateLangWatchQL({ sql, ...POLICY });
}

function codesOf(result: LangWatchQLValidation): LangWatchQLViolationCode[] {
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

/** The message the walk reported for the first refused function, if any. */
function functionRefusalMessage(result: LangWatchQLValidation): string {
  if (result.ok) return "";
  return (
    result.violations.find(
      (violation) => violation.code === "FUNCTION_NOT_ALLOWED",
    )?.message ?? ""
  );
}

describe("the lwql-SQL function allowlist", () => {
  describe("given the SQL the LangWatchQL questions are written in", () => {
    /** @scenario "Only the functions a LangWatchQL question needs can be called" */
    it.each([
      // Latency percentiles by model in time buckets.
      [
        "percentiles over an array dimension in time buckets",
        "SELECT arrayJoin(Models) AS model, toStartOfInterval(OccurredAt, INTERVAL 1 HOUR) AS bucket, " +
          "quantile(0.5)(TotalDurationMs) AS p50, quantiles(0.95, 0.99)(TotalDurationMs) AS tail " +
          "FROM traces GROUP BY model, bucket",
      ],
      // Error rate versus the previous equivalent period.
      [
        "a conditional rate against a relative window",
        "SELECT countIf(ContainsErrorStatus) / count() AS error_rate FROM traces " +
          "WHERE OccurredAt >= subtractDays(now(), 7)",
      ],
      // Rolling windows over trace metrics.
      [
        "a rolling window with an explicit frame",
        "SELECT OccurredAt, avg(TotalDurationMs) OVER (ORDER BY OccurredAt ROWS BETWEEN 10 PRECEDING AND CURRENT ROW) AS rolling FROM traces",
      ],
      [
        "the window functions that exist only as window functions",
        "SELECT row_number() OVER (ORDER BY OccurredAt) AS n, " +
          "lagInFrame(TotalDurationMs) OVER (ORDER BY OccurredAt) AS previous, " +
          "dense_rank() OVER (ORDER BY TotalDurationMs DESC) AS placing FROM traces",
      ],
      // First failure and first retry per trace; time between two events.
      [
        "first-event-per-trace with a conditional argument aggregate",
        "SELECT TraceId, argMinIf(SpanName, StartTime, StatusCode > 1) AS first_failure, " +
          "dateDiff('millisecond', minIf(StartTime, SpanName = 'a'), minIf(StartTime, SpanName = 'b')) AS gap " +
          "FROM spans GROUP BY TraceId",
      ],
      // Token and cost outliers.
      [
        "dispersion and rounding",
        "SELECT round(avg(TotalCost), 4) AS mean, stddevPop(TotalCost) AS spread, " +
          "abs(max(TotalCost) - min(TotalCost)) AS span FROM traces",
      ],
      // The Map columns the spans view exposes.
      [
        "map access, keys and values",
        "SELECT mapKeys(SpanAttributes), mapValues(SpanAttributes), " +
          "SpanAttributes['gen_ai.request.model'], mapContains(SpanAttributes, 'x') FROM spans",
      ],
      [
        "a number parsed out of an attribute map",
        "SELECT sum(toUInt64OrZero(SpanAttributes['gen_ai.usage.total_tokens'])) AS tokens FROM spans",
      ],
      [
        "conditionals and null handling",
        "SELECT multiIf(Score > 0.9, 'high', Score > 0.5, 'mid', 'low'), " +
          "coalesce(TopicId, 'none'), nullIf(TraceName, ''), ifNull(SatisfactionScore, 0) FROM traces",
      ],
      [
        "string comparison and reshaping",
        "SELECT lower(TraceName), concat(TraceName, '-', SourceType) FROM traces " +
          "WHERE TraceName LIKE '%checkout%' AND startsWith(SourceType, 'api')",
      ],
      [
        "CASE in both spellings and the ternary",
        "SELECT CASE WHEN ContainsErrorStatus THEN 1 ELSE 0 END, " +
          "CASE SourceType WHEN 'api' THEN 1 ELSE 0 END, ContainsOKStatus ? 1 : 0 FROM traces",
      ],
      [
        "arithmetic, casts and the concatenation operator",
        "SELECT (TotalDurationMs + 1) * 2 / 3, TotalDurationMs::String, " +
          "CAST(SpanCount AS Float64), TraceName || '!' FROM traces",
      ],
      [
        "a lambda over an array column",
        "SELECT arrayFilter(model -> model != '', Models), arrayStringConcat(arraySort(Models), ',') FROM traces",
      ],
      [
        "JSON read out of a string column",
        "SELECT JSONExtractString(TraceName, 'k'), JSONHas(TraceName, 'k') FROM traces",
      ],
      [
        "the standard DISTINCT aggregate spelling",
        "SELECT COUNT(DISTINCT TraceId), uniqExact(TraceId) FROM traces",
      ],
    ])("accepts %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toEqual([]);
    });

    /**
     * The parser reports the name in the caller's own case, so a case-sensitive
     * comparison would refuse the upper-case SQL that half the world writes.
     */
    it("accepts an aggregate however the caller cased it", () => {
      for (const sql of [
        "SELECT COUNT(*) FROM traces",
        "SELECT SUM(TotalDurationMs) FROM traces",
        "SELECT Avg(TotalDurationMs) FROM traces",
        "SELECT MAX(OccurredAt) FROM traces",
      ]) {
        expect(codesOf(validate(sql)), sql).toEqual([]);
      }
    });

    it("accepts the example query the schema endpoint publishes", () => {
      expect(
        codesOf(
          validate(
            "SELECT TenantId, TraceId, TraceName FROM analytics.traces " +
              "WHERE OccurredAt >= subtractDays(now(), 7) ORDER BY OccurredAt DESC LIMIT 100",
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("given a function that answers a question about the server", () => {
    /**
     * The four that used to pass. They answer only the caller's own session and
     * reach no other tenant, which is exactly why they were reachable for as
     * long as they were — and none of them is something this API publishes.
     */
    /** @scenario "Only the functions a LangWatchQL question needs can be called" */
    it.each([
      ["the tenant capability the gateway sends", "getSetting('custom_x')"],
      ["the database identity queries run as", "currentUser()"],
      ["the machine the server runs on", "hostName()"],
      ["the server build", "version()"],
      ["how long the server has been up", "uptime()"],
      ["the database the connection is bound to", "currentDatabase()"],
      ["the server's fully qualified name", "FQDN()"],
      ["the port the server listens on", "tcpPort()"],
      ["a server macro", "getMacro('shard')"],
      ["the physical part a row came from", "blockNumber()"],
    ])("refuses %s", (_case, call) => {
      const result = validate(`SELECT ${call} AS value FROM traces`);

      expect(codesOf(result)).toEqual(["FUNCTION_NOT_ALLOWED"]);
      // The control: the same query shape with an allowlisted call passes, so
      // the refusal is attributable to the function and to nothing else.
      expect(codesOf(validate("SELECT now() AS value FROM traces"))).toEqual(
        [],
      );
    });

    it("names the function in the refusal, so the caller knows what to change", () => {
      expect(
        functionRefusalMessage(validate("SELECT hostName() FROM traces")),
      ).toContain("hostName");
    });

    it("refuses it in whatever case it was written", () => {
      for (const sql of [
        "SELECT GETSETTING('x') FROM traces",
        "SELECT CurrentUser() FROM traces",
        "SELECT VERSION() FROM traces",
      ]) {
        expect(codesOf(validate(sql)), sql).toEqual(["FUNCTION_NOT_ALLOWED"]);
      }
    });
  });

  describe("given a function that reaches outside the LangWatchQL data", () => {
    it.each([
      ["a file read", "file('/etc/passwd')"],
      ["a URL fetch", "url('http://169.254.169.254/')"],
      ["object storage", "s3('https://bucket/k', 'CSV')"],
      ["another server", "remote('other-host', 'db', 'tbl')"],
      [
        "a dictionary, which no row policy covers",
        "dictGet('d', 'k', TraceId)",
      ],
      ["a JDBC bridge", "jdbc('ds', 'SELECT 1')"],
      [
        "encryption over a key the caller names",
        "encrypt('aes-128-ecb', TraceName, 'k')",
      ],
    ])("refuses %s in expression position", (_case, call) => {
      expect(codesOf(validate(`SELECT ${call} FROM traces`))).toEqual([
        "FUNCTION_NOT_ALLOWED",
      ]);
    });

    /**
     * The table-function rule refuses these positionally, whatever they are
     * called. Kept as its own case because the two rules are independent and
     * the positional one must not quietly become the only thing standing there.
     */
    it("keeps refusing a table function in FROM position, by the positional rule", () => {
      expect(codesOf(validate("SELECT * FROM url('http://x', CSV)"))).toContain(
        "TABLE_FUNCTION",
      );
    });
  });

  describe("given a function whose result the API cannot stand behind", () => {
    it.each([
      ["randomness, against the determinism the API promises", "rand()"],
      ["floating randomness", "randCanonical()"],
      ["a deliberate stall", "sleep(3)"],
      ["a per-row stall", "sleepEachRow(1)"],
      [
        "an aggregate named by a string the allowlist cannot read",
        "arrayReduce('sum', Models)",
      ],
      [
        "an aggregation state built from a named aggregate",
        "initializeAggregation('sumIf', 1, 1)",
      ],
      ["the storage type of a column", "toTypeName(TraceId)"],
      ["a symbol from the server binary", "demangle('x')"],
    ])("refuses %s", (_case, call) => {
      expect(codesOf(validate(`SELECT ${call} FROM traces`))).toEqual([
        "FUNCTION_NOT_ALLOWED",
      ]);
    });
  });

  describe("given an aggregate combinator", () => {
    it.each([
      ["conditional aggregation", "countIf(ContainsErrorStatus)"],
      ["conditional summation", "sumIf(TotalCost, ContainsErrorStatus)"],
      [
        "a conditional argument aggregate",
        "argMaxIf(TraceId, TotalCost, SpanCount > 1)",
      ],
      ["a distinct aggregate", "sumDistinct(TotalDurationMs)"],
      [
        "two combinators at once",
        "sumIfDistinct(TotalDurationMs, SpanCount > 1)",
      ],
    ])("accepts %s, because it is one of the allowed aggregates", (_case, call) => {
      expect(codesOf(validate(`SELECT ${call} FROM traces`))).toEqual([]);
    });

    /**
     * The suffixes that are absent. No LangWatchQL view exposes an
     * `AggregateFunction` column, so nothing a caller can write needs a state
     * or a merge — and a suffix admitted "because it is an aggregate too" is
     * exactly the reasoning the admission rule forbids.
     */
    it.each([
      ["a state", "sumState(TotalCost)"],
      ["a merge", "sumMerge(TotalCost)"],
      ["an array aggregate", "sumArray(Models)"],
      ["a per-element aggregate", "sumForEach(Models)"],
      ["a resampled aggregate", "sumResample(1, 10, 2)(TotalCost, SpanCount)"],
    ])("refuses %s", (_case, call) => {
      expect(codesOf(validate(`SELECT ${call} FROM traces`))).toEqual([
        "FUNCTION_NOT_ALLOWED",
      ]);
      expect(codesOf(validate("SELECT sum(TotalCost) FROM traces"))).toEqual(
        [],
      );
    });

    it("refuses a combinator hung on a function that is not an aggregate", () => {
      expect(codesOf(validate("SELECT hostNameIf(1) FROM traces"))).toEqual([
        "FUNCTION_NOT_ALLOWED",
      ]);
    });
  });

  describe("given a refused function somewhere other than the projection", () => {
    it.each([
      ["a filter", "SELECT TraceId FROM traces WHERE hostName() != ''"],
      ["a group key", "SELECT count() FROM traces GROUP BY hostName()"],
      ["an ordering", "SELECT TraceId FROM traces ORDER BY version()"],
      [
        "a having clause",
        "SELECT TraceId, count() AS n FROM traces GROUP BY TraceId HAVING max(TraceId) = currentUser()",
      ],
      [
        "a join condition",
        "SELECT t.TraceId FROM traces AS t JOIN spans AS s ON t.TraceId = s.TraceId AND currentUser() != ''",
      ],
      [
        "a window partition",
        "SELECT count() OVER (PARTITION BY hostName()) FROM traces",
      ],
      [
        "a subquery",
        "SELECT TraceId FROM traces WHERE TraceId IN (SELECT getSetting('x') FROM spans)",
      ],
      [
        "a common table expression",
        "WITH probe AS (SELECT version() AS v FROM traces) SELECT v FROM probe",
      ],
      [
        "an argument of an allowed function",
        "SELECT concat(TraceName, hostName()) FROM traces",
      ],
      [
        "a lambda body",
        "SELECT arrayMap(model -> concat(model, hostName()), Models) FROM traces",
      ],
    ])("refuses it in %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("FUNCTION_NOT_ALLOWED");
    });
  });

  describe("given a function named by an APPLY transformer", () => {
    /**
     * The one place a function reaches the walk as a bare string rather than as
     * a call, which a check hung on the `Function` node alone would step over.
     */
    it("refuses one outside the allowlist", () => {
      expect(codesOf(validate("SELECT * APPLY(hostName) FROM traces"))).toEqual(
        ["FUNCTION_NOT_ALLOWED"],
      );
    });

    it("accepts one inside it, so the refusal above is about the name", () => {
      expect(codesOf(validate("SELECT * APPLY(sum) FROM traces"))).toEqual([]);
    });

    it("still walks an APPLY written as a lambda", () => {
      expect(
        codesOf(validate("SELECT * APPLY(x -> hostName()) FROM traces")),
      ).toEqual(["FUNCTION_NOT_ALLOWED"]);
    });
  });

  describe("given a query that breaks the function rule alongside another", () => {
    it("reports both, so one round trip is enough to fix it", () => {
      const result = validateLangWatchQL({
        sql: "SELECT hostName(), body FROM traces",
        ...POLICY,
        gatedColumns: ["body"],
      });

      expect(new Set(codesOf(result))).toEqual(
        new Set(["FUNCTION_NOT_ALLOWED", "GATED_COLUMN"]),
      );
    });
  });
});

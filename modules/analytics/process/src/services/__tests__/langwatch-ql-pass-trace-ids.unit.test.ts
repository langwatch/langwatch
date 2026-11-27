/**
 * @vitest-environment node
 * A key, sample or page pass reads its view's trace-ids twin, cut by the traces it holds, and
 * reads the view as written while the twin is not readable yet (a rolling deploy).
 * @see specs/lwql/dedup-trace-ids.feature
 * @see modules/analytics/adrs/006-stock-widget-views-latest-in-order.md
 */
import {
  LangWatchQLInvalidQueryError,
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLUnavailableError,
  type LangWatchQLPass,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  ADMIT_EVERY_PLACEMENT,
  TEST_RUN_TELEMETRY,
} from "../../app/__tests__/analytics.fixture.ts";
import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import {
  langWatchQLPassKeysOfTracesSql,
  langWatchQLPassSql,
  LWQL_PASS_TRACE_IDS_PARAMETER,
} from "../../rules/langwatch-ql-pass-sql.rules.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const STATEMENT =
  "SELECT TraceId, Attributes['gen_ai.conversation.id'] AS ThreadId, " +
  "eval(TraceName, 'Is the name a greeting?') AS named FROM analytics.traces";
const SAMPLE: Extract<LangWatchQLPass, { kind: "sample" }> = {
  kind: "sample",
  keyColumns: ["ThreadId"],
  limit: 50,
  buckets: 4,
};
const PAGE_ROW_IDS = [{ TraceId: "t1" }, { TraceId: "t2" }];
const KEYS = [
  { TraceId: "t1", ThreadId: "a" },
  { TraceId: "t2", ThreadId: "b" },
];

/** As the executor translates ClickHouse's refusal of a twin it does not have. */
const twinMissing = () =>
  new LangWatchQLUnavailableError({
    reasons: [
      new Error(
        "Code: 46. DB::Exception: Unknown table function `analytics.traces__ids`. (UNKNOWN_FUNCTION)",
      ),
    ],
  });

/**
 * A ClickHouse whose relation `missing` refuses with `refusal`: a row-ids read answers
 * {@link PAGE_ROW_IDS}, any other read {@link KEYS}. The first `shortTwinReads` reads of the
 * twin lose the page's last trace, as a moving window can between the two steps.
 */
class Deployment extends LangWatchQLExecutorRepository {
  readonly sent: LangWatchQLExecutionRequest[] = [];
  private readonly missing: RegExp | undefined;
  private readonly refusal: () => Error;
  private shortTwinReads: number;

  constructor({
    missing,
    refusal = twinMissing,
    shortTwinReads = 0,
  }: { missing?: RegExp; refusal?: () => Error; shortTwinReads?: number } = {}) {
    super();
    this.missing = missing;
    this.refusal = refusal;
    this.shortTwinReads = shortTwinReads;
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.sent.push(request);
    if (this.missing?.test(request.sql)) return Promise.reject(this.refusal());
    const isTwinRead = request.sql.includes("__ids(");
    const isShort = isTwinRead && this.shortTwinReads > 0;
    if (isShort) this.shortTwinReads -= 1;
    const keys = isShort ? KEYS.slice(0, -1) : KEYS;
    const rows = request.sql.startsWith("SELECT k.TraceId") ? PAGE_ROW_IDS : keys;
    return Promise.resolve({
      columns: [{ name: "TraceId", type: "String" }],
      rows,
      statistics: { elapsedMs: 1, rowsRead: 10, bytesRead: 100, rowsReturned: rows.length },
    });
  }
}

function runPass({
  executor,
  pass,
  sql = STATEMENT,
  parameters,
}: {
  executor: Deployment;
  pass: LangWatchQLPass;
  sql?: string;
  parameters?: Record<string, string>;
}) {
  return LangWatchQLService.create({
    runTelemetry: TEST_RUN_TELEMETRY,
    placement: ADMIT_EVERY_PLACEMENT,
    executor,
    database: "analytics",
  }).executePass({
    project: { id: "project-1", lwqlKey: "key-1" },
    protections: { catalogue: EVERY_CATALOGUE_PERMISSION },
    sql,
    ...(parameters ? { parameters } : {}),
    pass,
    isInstantEvalsEnabled: true,
  });
}

describe("given a two-step sample pass", () => {
  describe("when both steps answer", () => {
    /** @scenario "A key or sample pass reads its keys over the trace-ids twin, cut by its page's traces" */
    it("reports the rows and bytes both steps read, and the rows the page returned", async () => {
      const result = await runPass({ executor: new Deployment(), pass: SAMPLE });

      expect(result.statistics).toEqual({
        elapsedMs: 2,
        rowsRead: 20,
        bytesRead: 200,
        rowsReturned: 2,
      });
    });
  });

  describe("when a moving window drops a picked trace before the keys are read", () => {
    /** @scenario "A two-step page that loses a picked row is read again, then as one read" */
    it("reads both steps again from the same cursor and returns the whole page", async () => {
      const executor = new Deployment({ shortTwinReads: 1 });

      const result = await runPass({ executor, pass: SAMPLE });

      expect(executor.sent).toHaveLength(4);
      expect(result.rows).toEqual(KEYS);
    });

    /** @scenario "A two-step page that loses a picked row is read again, then as one read" */
    it("reads the page as one query when the steps keep disagreeing", async () => {
      const executor = new Deployment({ shortTwinReads: 10 });

      const result = await runPass({ executor, pass: SAMPLE });

      expect(executor.sent.at(-1)?.sql).toBe(
        langWatchQLPassSql({ sql: STATEMENT, pass: SAMPLE }).sql,
      );
      expect(executor.sent).toHaveLength(5);
      expect(result.rows).toEqual(KEYS);
    });
  });

  describe("when the statement declares the parameter the key step binds the traces in", () => {
    /** @scenario "A pass statement the cut could change reads the view as written" */
    it("sends today's single read, so the caller's value is not overwritten", async () => {
      const declaring = `${STATEMENT} WHERE TraceName != {lwql_pass_trace_ids:String}`;
      const executor = new Deployment();

      await runPass({
        executor,
        pass: SAMPLE,
        sql: declaring,
        parameters: { lwql_pass_trace_ids: "x" },
      });

      expect(executor.sent.map(({ sql }) => sql)).toEqual([
        langWatchQLPassSql({ sql: declaring, pass: SAMPLE }).sql,
      ]);
    });
  });

  describe("when the statement declares the key step's parameter behind a comment", () => {
    /** @scenario "A pass statement the cut could change reads the view as written" */
    it("still sends today's single read", async () => {
      const declaring = `${STATEMENT} WHERE TraceName != {lwql_pass_trace_ids /*x*/ :String}`;
      const executor = new Deployment();

      await runPass({
        executor,
        pass: SAMPLE,
        sql: declaring,
        parameters: { lwql_pass_trace_ids: "x" },
      });

      expect(executor.sent.map(({ sql }) => sql)).toEqual([
        langWatchQLPassSql({ sql: declaring, pass: SAMPLE }).sql,
      ]);
    });
  });

  describe("when the refusal names a relation whose name only starts like the twin's", () => {
    /** @scenario "A pass reads its view as written while the trace-ids twin is not readable" */
    it.each([
      "Code: 46. DB::Exception: Unknown table function `traces__ids_stage.evaluations`. (UNKNOWN_FUNCTION)",
      "Code: 60. DB::Exception: Unknown table expression identifier 'analytics.traces__ids_stage'",
      "Code: 81. DB::Exception: Database traces__ids_stage does not exist. (UNKNOWN_DATABASE)",
      "Code: 60. DB::Exception: Table other.traces__ids does not exist. (UNKNOWN_TABLE)",
    ])("refuses the pass for %s", async (message) => {
      const executor = new Deployment({
        missing: /traces__ids/,
        refusal: () => new LangWatchQLUnavailableError({ reasons: [new Error(message)] }),
      });

      await expect(runPass({ executor, pass: SAMPLE })).rejects.toBeInstanceOf(
        LangWatchQLUnavailableError,
      );
      expect(executor.sent).toHaveLength(2);
    });
  });

  describe("when the twin read is refused as unavailable over another relation", () => {
    /** @scenario "A pass reads its view as written while the trace-ids twin is not readable" */
    it("refuses the pass rather than reading it as written", async () => {
      const executor = new Deployment({
        missing: /traces__ids/,
        refusal: () =>
          new LangWatchQLUnavailableError({
            reasons: [
              new Error(
                "Code: 60. DB::Exception: Unknown table expression identifier " +
                  "'analytics.evaluations' in scope SELECT * FROM analytics.traces__ids(...)",
              ),
            ],
          }),
      });

      await expect(runPass({ executor, pass: SAMPLE })).rejects.toBeInstanceOf(
        LangWatchQLUnavailableError,
      );
      expect(executor.sent).toHaveLength(2);
    });
  });
});

describe("given a sample pass over traces projecting the thread id", () => {
  describe("when the twin is provisioned", () => {
    /** @scenario "A key or sample pass reads its keys over the trace-ids twin, cut by its page's traces" */
    it("reads the page's row ids, then its keys over the twin cut by those traces", async () => {
      const executor = new Deployment();

      const result = await runPass({ executor, pass: SAMPLE });

      expect(executor.sent).toHaveLength(2);
      expect(executor.sent[0]?.sql).not.toContain("__ids");
      expect(executor.sent[1]?.sql).toContain(
        "FROM analytics.traces__ids(lwql_trace_ids = {lwql_pass_trace_ids:Array(String)}) AS traces",
      );
      expect(executor.sent[1]?.parameters).toMatchObject({
        [LWQL_PASS_TRACE_IDS_PARAMETER]: ["t1", "t2"],
      });
      expect(result.rows).toEqual(KEYS);
    });
  });

  describe("when the twin is not provisioned yet", () => {
    /** @scenario "A pass reads its view as written while the trace-ids twin is not readable" */
    it("reads the keys of the same traces from the statement as written", async () => {
      const executor = new Deployment({ missing: /traces__ids/ });

      const result = await runPass({ executor, pass: SAMPLE });

      expect(executor.sent.map(({ sql }) => sql)).toEqual([
        executor.sent[0]?.sql,
        executor.sent[1]?.sql,
        langWatchQLPassKeysOfTracesSql({ sql: STATEMENT, pass: SAMPLE, traceIds: ["t1", "t2"] })
          .sql,
      ]);
      expect(executor.sent[1]?.sql).toContain("traces__ids(");
      expect(result.rows).toEqual(KEYS);
    });
  });

  describe("when the twin exists but its grant has not landed", () => {
    /** @scenario "A pass reads its view as written while the trace-ids twin is not readable" */
    it("reads the statement as written once", async () => {
      const executor = new Deployment({
        missing: /traces__ids/,
        refusal: () =>
          new LangWatchQLProvisioningIncompleteError({
            reasons: [
              new Error(
                "Code: 497. DB::Exception: user: Not enough privileges. To execute this query, " +
                  "it's necessary to have the grant SELECT ON analytics.traces__ids. (ACCESS_DENIED)",
              ),
            ],
          }),
      });

      const result = await runPass({ executor, pass: SAMPLE });

      expect(executor.sent).toHaveLength(3);
      expect(executor.sent[2]?.sql).not.toContain("__ids");
      expect(result.rows).toEqual(KEYS);
    });
  });

  describe("when the twin read is refused for another reason", () => {
    /** @scenario "A pass reads its view as written while the trace-ids twin is not readable" */
    it("refuses the pass rather than reading it again", async () => {
      const executor = new Deployment({
        missing: /traces__ids/,
        refusal: () => new LangWatchQLInvalidQueryError(),
      });

      await expect(runPass({ executor, pass: SAMPLE })).rejects.toBeInstanceOf(
        LangWatchQLInvalidQueryError,
      );
      expect(executor.sent).toHaveLength(2);
    });
  });
});

describe("given a page pass over traces", () => {
  const PAGE: LangWatchQLPass = { kind: "page", traceIds: ["t1", "t2"] };

  describe("when the twin is provisioned", () => {
    /** @scenario "A page pass reads the trace-ids twin cut by its own traces" */
    it("reads the twin cut by the page's own trace ids", async () => {
      const executor = new Deployment();

      await runPass({ executor, pass: PAGE });

      expect(executor.sent).toHaveLength(1);
      expect(executor.sent[0]?.sql).toContain(
        "FROM analytics.traces__ids(lwql_trace_ids = {lwql_hydration_trace_ids:Array(String)}) AS traces",
      );
    });
  });

  describe("when the twin is not provisioned yet", () => {
    /** @scenario "A pass reads its view as written while the trace-ids twin is not readable" */
    it("reads the page from the statement as written", async () => {
      const executor = new Deployment({ missing: /traces__ids/ });

      await runPass({ executor, pass: PAGE });

      expect(executor.sent.map(({ sql }) => sql).at(-1)).toBe(
        langWatchQLPassSql({ sql: STATEMENT, pass: PAGE }).sql,
      );
    });
  });
});

describe("given a pass statement whose rows a cut by trace could change", () => {
  describe("when the sample pass runs", () => {
    /** @scenario "A pass statement the cut could change reads the view as written" */
    it("sends today's single read, with no twin", async () => {
      const limited = `${STATEMENT} ORDER BY OccurredAt LIMIT 100`;
      const executor = new Deployment();

      await runPass({ executor, pass: SAMPLE, sql: limited });

      expect(executor.sent.map(({ sql }) => sql)).toEqual([
        langWatchQLPassSql({ sql: limited, pass: SAMPLE }).sql,
      ]);
    });
  });
});

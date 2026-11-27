/**
 * @vitest-environment node
 * A pass's statement is sent to its view's trace-ids twin only when cutting the view by trace
 * cannot change the rows of the traces the pass reads; which views get a twin, and its shape.
 * @see specs/lwql/dedup-trace-ids.feature
 * @see modules/analytics/adrs/006-stock-widget-views-latest-in-order.md
 */
import { describe, expect, it } from "vitest";

import {
  LangWatchQLViewStatementsService,
  SHIPPED_LWQL_DEDUP,
} from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { LangWatchQLViewTwinStatementsService } from "../../features/provisioning/services/langwatch-ql-view-twin-statements.service.ts";
import { LangWatchQLAccessModelDefinitionService } from "../../services/langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../../services/langwatch-ql-access-model.service.ts";
import {
  refusalNamesTwin,
  restrictLangWatchQLToTraceIds,
  traceIdsViewNames,
} from "../lwql-dedup-trace-ids.rules.ts";
import { LWQL_VIEW_CATALOG, pickLwqlViewByName } from "../lwql-view-catalog.rules.ts";

const IDS = "{lwql_pass_trace_ids:Array(String)}";
const TWIN = `traces__ids(lwql_trace_ids = ${IDS})`;

const NAMES: LangWatchQLNames = {
  database: "lwql",
  restrictedUser: "lwql_reader",
  settingsProfile: "lwql_profile",
  keyMapTable: "lwql_key_map",
  tenantSetting: "custom_lwql_key",
};

const send = (sql: string) =>
  restrictLangWatchQLToTraceIds({ sql, database: "lwql", views: LWQL_VIEW_CATALOG, traceIds: IDS })
    .sql;

const viewStatements = LangWatchQLViewStatementsService.create();
const twinStatements = LangWatchQLViewTwinStatementsService.create();

function render(name: string) {
  const view = pickLwqlViewByName(name);
  if (!view) throw new Error(`${name} is not in the catalog`);
  const statement = { names: NAMES, sourceDatabase: "app", view, dedup: SHIPPED_LWQL_DEDUP };
  return {
    view: viewStatements.viewStatement(statement),
    twins: twinStatements.traceIdsViewStatements(statement),
  };
}

describe("given the shipped catalogue", () => {
  describe("when its trace-ids twins are listed", () => {
    /** @scenario "A latest-in-order view keyed by trace gets a trace-ids twin cut before LIMIT 1 BY" */
    it("names one per latest-in-order view keyed by TraceId", () => {
      expect(traceIdsViewNames(LWQL_VIEW_CATALOG)).toEqual([
        "traces__ids",
        "trace_metrics__ids",
        "simulation_trace_metrics__ids",
      ]);
    });
  });

  describe("when the traces twin is rendered", () => {
    /** @scenario "A latest-in-order view keyed by trace gets a trace-ids twin cut before LIMIT 1 BY" */
    it("is the view with the trace cut read before ORDER BY and LIMIT 1 BY, and nothing else", () => {
      const { view, twins } = render("traces");

      expect(twins).toHaveLength(1);
      const [twin = ""] = twins;
      expect(twin).toMatch(/^CREATE OR REPLACE VIEW lwql\.traces__ids\n/);
      expect(twin).toContain(
        "  FROM app.trace_summaries\n" +
          "  WHERE `TraceId` IN ({lwql_trace_ids:Array(String)})\n" +
          "  ORDER BY ",
      );
      expect(
        twin
          .replace("traces__ids", "traces")
          .replace("  WHERE `TraceId` IN ({lwql_trace_ids:Array(String)})\n", ""),
      ).toBe(view);
    });

    /** @scenario "A latest-in-order view keyed by trace gets a trace-ids twin cut before LIMIT 1 BY" */
    it("gives no twin to a view a caller's filter already reaches, or one not keyed by trace", () => {
      expect(render("spans").twins).toEqual([]);
      expect(render("evaluations").twins).toEqual([]);
    });
  });

  describe("when the access model is built", () => {
    /** @scenario "Each trace-ids twin is granted to the restricted identity" */
    it("grants SELECT on each twin, beside its view", () => {
      const definition = LangWatchQLAccessModelDefinitionService.create().build({
        names: NAMES,
        passwordSha256Hex: "a".repeat(64),
        namedCollection: {
          collection: "lwql_postgres",
          host: "pg.internal",
          port: 5432,
          database: "app",
          user: "lwql_ro",
          password: "reader-secret",
        },
        sourceDatabase: "app",
      });
      const ddl = LangWatchQLAccessModelDefinitionService.create().renderDdl(definition);

      for (const twin of traceIdsViewNames(LWQL_VIEW_CATALOG)) {
        expect(ddl).toContain(`GRANT SELECT ON lwql.${twin} TO lwql_reader`);
      }
    });
  });
});

describe("given a pass statement over a twin-able view", () => {
  const REWRITTEN: readonly (readonly [string, string, string])[] = [
    [
      "a bare view, which keeps its name as the alias",
      "SELECT TraceId, OccurredAt FROM traces WHERE OccurredAt >= now() - INTERVAL 7 DAY",
      `SELECT TraceId, OccurredAt FROM ${TWIN} AS traces WHERE OccurredAt >= now() - INTERVAL 7 DAY`,
    ],
    [
      "a database-qualified view with no longer reference",
      "SELECT TraceId, Attributes['gen_ai.conversation.id'] AS ThreadId FROM lwql.traces ORDER BY TraceId",
      `SELECT TraceId, Attributes['gen_ai.conversation.id'] AS ThreadId FROM lwql.${TWIN} AS traces ORDER BY TraceId`,
    ],
    [
      "an aliased view, its trace column qualified",
      "SELECT t.TraceId, eval(t.TraceName, 'ok?') AS ok FROM traces AS t",
      `SELECT t.TraceId, eval(t.TraceName, 'ok?') AS ok FROM ${TWIN} AS t`,
    ],
    [
      "a star projection",
      "SELECT * FROM trace_metrics WHERE TotalCost > 0",
      `SELECT * FROM trace_metrics__ids(lwql_trace_ids = ${IDS}) AS trace_metrics WHERE TotalCost > 0`,
    ],
    [
      "a subquery in WHERE, which is left reading the view",
      "SELECT TraceId FROM traces WHERE TraceId IN (SELECT TraceId FROM traces WHERE SpanCount > 3)",
      `SELECT TraceId FROM ${TWIN} AS traces WHERE TraceId IN (SELECT TraceId FROM traces WHERE SpanCount > 3)`,
    ],
  ];

  describe("when its rows are the view's rows, one each, with the view's own TraceId", () => {
    /** @scenario "A pass statement the cut cannot change reads the trace-ids twin" */
    it.each(REWRITTEN)("reads the twin for %s", (_shape, sql, expected) => {
      expect(send(sql)).toBe(expected);
    });
  });

  const AS_WRITTEN: readonly (readonly [string, string])[] = [
    ["a GROUP BY", "SELECT TraceId, count() AS n FROM traces GROUP BY TraceId"],
    ["an aggregate with no GROUP BY", "SELECT any(TraceId) AS TraceId FROM traces"],
    ["a HAVING", "SELECT TraceId FROM traces GROUP BY TraceId HAVING count() > 1"],
    [
      "a window function",
      "SELECT TraceId, row_number() OVER (ORDER BY OccurredAt) AS n FROM traces",
    ],
    ["a LIMIT", "SELECT TraceId FROM traces ORDER BY OccurredAt LIMIT 10"],
    ["a LIMIT BY", "SELECT TraceId FROM traces ORDER BY TraceId LIMIT 1 BY TraceName"],
    ["a DISTINCT", "SELECT DISTINCT TraceId FROM traces"],
    [
      "a JOIN",
      "SELECT t.TraceId FROM traces AS t INNER JOIN trace_metrics AS m ON t.TraceId = m.TraceId",
    ],
    ["an ARRAY JOIN", "SELECT TraceId, model FROM traces ARRAY JOIN Models AS model"],
    ["a UNION", "SELECT TraceId FROM traces UNION ALL SELECT TraceId FROM traces"],
    ["a renamed TraceId", "SELECT TraceName AS TraceId FROM traces"],
    ["a second column named TraceId", "SELECT TraceId, TraceName AS TraceId FROM traces"],
    ["no TraceId projected", "SELECT TraceName FROM traces"],
    [
      "a WITH of the view's name",
      "WITH traces AS (SELECT * FROM lwql.traces) SELECT TraceId FROM traces",
    ],
    ["a three-part column", "SELECT lwql.traces.TraceId FROM lwql.traces"],
    ["a view with no twin", "SELECT TraceId FROM evaluations"],
    ["a view a caller's filter already reaches", "SELECT TraceId FROM spans"],
    ["a FROM subquery", "SELECT TraceId FROM (SELECT TraceId FROM traces) AS s"],
    ["a statement that does not parse", "SELECT TraceId FROM traces WHERE ("],
    [
      "a COLUMNS transformer",
      "SELECT COLUMNS(TraceId) REPLACE ('fixed' AS TraceId), TraceId FROM traces",
    ],
    ["a star REPLACE", "SELECT * REPLACE ('fixed' AS TraceId) FROM traces"],
    ["a star APPLY", "SELECT * APPLY (toString) FROM traces"],
    ["a star EXCEPT", "SELECT * EXCEPT (TraceName) FROM traces"],
    ["a qualified star", "SELECT traces.* FROM traces"],
    [
      "the view name beside its alias",
      "SELECT t.TraceId, traces.TraceName AS ThreadId FROM traces AS t",
    ],
    [
      "the database-qualified view name beside its alias",
      "SELECT t.TraceId, lwql.traces.TraceName AS ThreadId FROM lwql.traces AS t",
    ],
    [
      "a subcolumn path from the view name beside its alias",
      "SELECT t.TraceId, traces.Models.size0 AS n FROM traces AS t",
    ],
    [
      "a subcolumn path from the database-qualified view name beside its alias",
      "SELECT t.TraceId, lwql.traces.Models.size0 AS n FROM lwql.traces AS t",
    ],
  ];

  describe("when cutting the view could change a row the pass reads", () => {
    /** @scenario "A pass statement the cut could change reads the view as written" */
    it.each(AS_WRITTEN)("sends %s as written", (_shape, sql) => {
      expect(send(sql)).toBe(sql);
    });
  });
});

describe("given a ClickHouse refusal of a pass's twin read", () => {
  const TWIN_NAMED: readonly (readonly [string, boolean])[] = [
    [
      "Code: 46. DB::Exception: Unknown table function `analytics.traces__ids`. (UNKNOWN_FUNCTION)",
      true,
    ],
    ["Code: 46. DB::Exception: Unknown table function `analytics`.`traces__ids`.", true],
    ["Code: 60. DB::Exception: Table traces__ids doesn't exist. (UNKNOWN_TABLE)", true],
    [
      "Code: 497. DB::Exception: u: Not enough privileges. To execute this query, it's necessary " +
        "to have the grant SELECT(TraceId) ON analytics.traces__ids. (ACCESS_DENIED)",
      true,
    ],
    ["Code: 46. DB::Exception: Unknown table function `traces__ids_stage.evaluations`.", false],
    [
      "Code: 60. DB::Exception: Unknown table expression identifier 'analytics.traces__ids_stage'",
      false,
    ],
    ["Code: 60. DB::Exception: Table other.traces__ids does not exist. (UNKNOWN_TABLE)", false],
    [
      "Code: 81. DB::Exception: Database traces__ids_stage does not exist. (UNKNOWN_DATABASE)",
      false,
    ],
    [
      "Code: 60. DB::Exception: Unknown table expression identifier 'analytics.evaluations' " +
        "in scope SELECT * FROM analytics.traces__ids(lwql_trace_ids = ['t1'])",
      false,
    ],
  ];

  describe("when it names a relation", () => {
    /** @scenario "A pass reads its view as written while the trace-ids twin is not readable" */
    it.each(TWIN_NAMED)("tells whether %s names the twin", (message, names) => {
      expect(refusalNamesTwin({ message, twin: "analytics.traces__ids" })).toBe(names);
    });
  });
});

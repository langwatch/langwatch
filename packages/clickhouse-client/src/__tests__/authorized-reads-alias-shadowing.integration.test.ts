/** @vitest-environment node */

/**
 * ADR-201 v1.19: under ClickHouse's defaults an alias named like a column the fence reads makes the
 * fence read the alias, so another tenant's span passes. The reader's pinned settings and its
 * refusal of such an alias each close that. Spec: specs/governance/aggregate-project.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { BRAID_CONDITION_COMPILER_VERSION } from "@langwatch/authorization";
import { tenantScopeWithConditions } from "@langwatch/clickhouse-markers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  braidConditionExpression,
  expandStatement,
  fenceExpression,
  PINNED_SETTINGS,
} from "../authorized-reads.ts";
import { startTestClickHouseEndpoints } from "../clickhouse-test-endpoints.ts";
import { StatementScopeError } from "../statementScopeError.ts";

const READER = "proj_reader";
const OTHER = "proj_other";
const TABLE = "alias_shadow_spans";

/** The reader's own project, fenced outright; the other tenant is fenced out. */
const FENCE = { own: [READER], shared: [] };
const tenant = fenceExpression({ fence: FENCE, column: "StartTime" });
/** A braid predicate the other tenant's span fails: its stored orchestrator is `api`. */
const predicate = braidConditionExpression({
  compiledWhere: {
    version: BRAID_CONDITION_COMPILER_VERSION,
    tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
  },
  reader: READER,
  prefix: "probe",
});

/** Each attack: the projection or WITH that shadows, and the fence it defeats. */
const ATTACKS = [
  {
    name: "a SELECT-list alias of TenantId",
    head: `SELECT SpanId, '${READER}' AS TenantId FROM ${TABLE}`,
    where: tenant,
  },
  {
    name: "a WITH alias of TenantId",
    head: `WITH '${READER}' AS TenantId SELECT SpanId FROM ${TABLE}`,
    where: tenant,
  },
  {
    name: "a SELECT-list alias of SpanAttributes under a braid predicate",
    head: `SELECT SpanId, map('orchestrator', 'web') AS SpanAttributes FROM ${TABLE}`,
    where: predicate,
  },
] as const;

let probe: ClickHouseClient;

async function spansRead({
  attack,
  settings,
}: {
  attack: (typeof ATTACKS)[number];
  settings: Record<string, number>;
}): Promise<string[]> {
  const result = await probe.query({
    query: `${attack.head} WHERE ${attack.where.sql} ORDER BY SpanId`,
    query_params: { ...tenant.params, ...attack.where.params },
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  const rows = await result.json<{ SpanId: string }>();
  return rows.map((row) => row.SpanId);
}

describe("a statement whose alias shadows a column the fence reads", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "alias-shadowing",
      names: ["shared"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("A ClickHouse endpoint was not provisioned");
    probe = createClient({ url: endpoint.url });
    await probe.command({
      query:
        `CREATE OR REPLACE TABLE ${TABLE} (TenantId String, SpanId String, StartTime DateTime64(3),` +
        " SpanAttributes Map(String, String)) ENGINE = MergeTree ORDER BY (TenantId, SpanId)",
    });
    await probe.insert({
      table: TABLE,
      format: "JSONEachRow",
      values: [
        {
          TenantId: READER,
          SpanId: "span_reader",
          StartTime: 0,
          SpanAttributes: { orchestrator: "web" },
        },
        {
          TenantId: OTHER,
          SpanId: "span_other",
          StartTime: 0,
          SpanAttributes: { orchestrator: "api" },
        },
      ],
    });
  }, 300_000);

  afterAll(async () => {
    await probe?.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
    await probe?.close();
  }, 60_000);

  for (const attack of ATTACKS) {
    describe(`given ${attack.name}`, () => {
      /** @scenario "A column always wins over an alias of its name" */
      it("lets the other tenant's span through under ClickHouse's defaults", async () => {
        const spans = await spansRead({ attack, settings: { prefer_column_name_to_alias: 0 } });

        expect(spans).toEqual(["span_other", "span_reader"]);
      });

      /** @scenario "A column always wins over an alias of its name" */
      it("reads only the fenced span under the reader's pinned settings", async () => {
        const spans = await spansRead({ attack, settings: { ...PINNED_SETTINGS } });

        expect(spans).toEqual(["span_reader"]);
      });

      /** @scenario "No alias takes a name the fence reads" */
      it("is refused before it is sent", () => {
        const query = `${attack.head} WHERE ${tenantScopeWithConditions("StartTime")}`;
        const refusal = (() => {
          try {
            expandStatement({ query, queryParams: {}, fence: FENCE });
            return undefined;
          } catch (error) {
            return error instanceof StatementScopeError ? error.violation.kind : error;
          }
        })();

        expect(refusal).toBe("shadowing-alias");
      });
    });
  }
});

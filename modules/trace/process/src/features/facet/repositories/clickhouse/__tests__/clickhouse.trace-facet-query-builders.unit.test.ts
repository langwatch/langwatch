// The queryBuilder and dynamic-keys facets as built statements: fenced by the proof with the
// tenant setting, capped, the prefix bound; the companion integration suite proves the counts.
import { describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceFilterCompileFor } from "../../../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import type {
  DynamicKeysDef,
  FacetQueryContext,
  QueryBuilderCategoricalDef,
} from "../../../rules/trace-facet-registry.rules.ts";
import { EVALUATOR_FACET } from "../clickhouse.trace-facet-evaluator.repository.ts";
import { EVENT_FACET } from "../clickhouse.trace-facet-events.repository.ts";
import { FACET_REGISTRY } from "../clickhouse.trace-facet-registry.mapper.ts";
import { SPAN_ATTRIBUTE_KEYS_FACET } from "../clickhouse.trace-facet-span-attribute-keys.repository.ts";

const timeRange = { from: 1_000, to: 2_000 };

function ctx(overrides: Partial<FacetQueryContext> = {}): FacetQueryContext {
  return {
    authorization: ownProof({ projectId: "tenant-1" }),
    timeRange,
    limit: 50,
    offset: 0,
    ...overrides,
  };
}

const queryBuilders = FACET_REGISTRY.filter(
  (def): def is QueryBuilderCategoricalDef | DynamicKeysDef => "queryBuilder" in def,
);
const keyDiscovery = ["spanAttributeKeys", "eventAttributeKeys", "metadataKeys", "metadata"];

describe("each queryBuilder facet's built statement", () => {
  it.each(queryBuilders.map((def) => [def.key, def] as const))(
    "[%s] is a reader statement fenced by the proof with the tenant setting and the time cap",
    (_key, def) => {
      const statement = def.queryBuilder(ctx());

      expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "tenant-1" });
      expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "tenant-1" });
      expect(statement.sql).toContain("max_execution_time = 20");
      expect(statement.sql).not.toContain("{{tenantScope");
    },
  );

  it.each(queryBuilders.map((def) => [def.key, def] as const))(
    "[%s] binds a value prefix rather than inlining it",
    (_key, def) => {
      const statement = def.queryBuilder(ctx({ prefix: "needle" }));

      expect(statement.sql).not.toContain("needle");
      expect(Object.values(statement.params ?? {}).some((v) => String(v).includes("needle"))).toBe(
        true,
      );
    },
  );

  it.each(keyDiscovery)(
    "[%s] reads map keys from their subcolumn and spills a large GROUP BY",
    (key) => {
      const def = queryBuilders.find((each) => each.key === key)!;
      const { sql } = def.queryBuilder(ctx());

      expect(sql).toContain("optimize_functions_to_subcolumns = 1");
      expect(sql).toContain("max_bytes_before_external_group_by = 536870912");
      expect(sql).not.toMatch(/length\((SpanAttributes|Attributes)\)/);
    },
  );

  it("flattens every event's attribute map for the event attribute keys", () => {
    const def = queryBuilders.find((each) => each.key === "eventAttributeKeys")!;

    expect(def.queryBuilder(ctx()).sql).toContain(
      "arrayJoin(mapKeys(arrayJoin(`Events.Attributes`)))",
    );
  });

  describe("given a filter on a facet over another table", () => {
    /** @scenario "A live window leaves the facet membership uncapped" */
    it("leaves the trace membership's upper bound off for a live window", () => {
      const compileFilter = traceFilterCompileFor({ queryText: "service:api", timeRange });
      const live = EVALUATOR_FACET.queryBuilder(
        ctx({ timeRange: { ...timeRange, live: true }, compileFilter }),
      );
      const absolute = EVALUATOR_FACET.queryBuilder(ctx({ compileFilter }));

      expect(live.sql).toContain(
        "tuple(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM trace_summaries",
      );
      expect(live.sql).not.toContain("<= fromUnixTimestamp64Milli");
      expect(absolute.sql).toContain("OccurredAt <= fromUnixTimestamp64Milli");
    });
  });
});

describe("the evaluator facet", () => {
  /** @scenario Evaluator facet labels drop the type prefix */
  it("labels rows by name, or by id when unnamed, and keys them by id", () => {
    const { sql } = EVALUATOR_FACET.queryBuilder(ctx());

    expect(sql).toContain("EvaluatorId AS facet_value");
    expect(sql).toMatch(
      /if\(ifNull\(EvaluatorName, \{v\d+:String\}\) != \{v\d+:String\}, EvaluatorName, EvaluatorId\) AS facet_label/,
    );
  });

  /** @scenario Binary 0/1 score hides the score slider */
  it("counts distinct non-null scores up to three", () => {
    expect(EVALUATOR_FACET.queryBuilder(ctx()).sql).toContain(
      "uniqUpTo(2)(Score) AS distinct_scores",
    );
  });

  /** @scenario Evaluator label values are filterable */
  it("returns the top emitted labels with their counts", () => {
    const { sql } = EVALUATOR_FACET.queryBuilder(ctx());

    expect(sql).toContain("sumMap(array(ifNull(Label,");
    expect(sql).toContain("AS label_values");
  });
});

describe("the event facet", () => {
  /** @scenario "Expanding the thumbs_up_down row shows its vote values with counts" */
  it("buckets each event's own event.metrics attributes, ranked by count", () => {
    const { sql, params } = EVENT_FACET.queryBuilder(ctx());

    expect(sql).toContain("arrayZip(`Events.Name`, `Events.Attributes`)");
    expect(sql).toContain("AS metric_values");
    expect(Object.values(params ?? {})).toContain("event.metrics.");
  });
});

describe("the span attribute keys facet", () => {
  it("is registered once, as dynamic keys on stored_spans", () => {
    expect(FACET_REGISTRY.filter((def) => def.key === "spanAttributeKeys")).toEqual([
      SPAN_ATTRIBUTE_KEYS_FACET,
    ]);
    expect(SPAN_ATTRIBUTE_KEYS_FACET).toMatchObject({
      kind: "dynamic_keys",
      table: "stored_spans",
    });
  });

  /** @scenario Reserved namespace is excluded from user-visible facet enumeration */
  it("leaves out keys in the reserved namespace", () => {
    const { sql, params } = SPAN_ATTRIBUTE_KEYS_FACET.queryBuilder(ctx());

    expect(sql).toMatch(/NOT \(startsWith\(key, \{v\d+:String\}\)\)/);
    expect(Object.values(params ?? {})).toContain("langwatch.reserved.");
  });
});

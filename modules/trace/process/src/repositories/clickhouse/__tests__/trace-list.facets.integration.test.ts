/**
 * Built facet reads (ADR-202), as the app reader, return main's 26.8 counts, kept as literals,
 * under each scope with another tenant sharing ids; ties on a count compare in value order.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import type { Authorization } from "@langwatch/authorization";
import {
  type MigratedAppReaderClickHouse,
  startMigratedAppReaderClickHouse,
} from "@langwatch/test-harness/clickhouse-app-reader";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { traceFilterCompileFor } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { facetScopesOf, facetSeedOf, seedFacetRows } from "./support/trace-facet-seed.support.ts";

const NOW = Date.now();
const seed = facetSeedOf({ run: nanoid(6), now: NOW });
const SCOPES = facetScopesOf(seed);

/** The facet filters: none, one on the summary itself, and one on a side table (spans). */
const FILTERS = { none: "", svc: "NOT service:api-b", span: "span.attribute.kind:keep" } as const;
type FilterName = keyof typeof FILTERS;

const MAIN: Record<string, Record<string, unknown>> = {
  "the member's own proof": {
    "none:batch:summaries": {
      categoricals: {
        status: {
          values: [
            { value: "ok", count: 2 },
            { value: "error", count: 1 },
          ],
          totalDistinct: 2,
        },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-b", count: 1 },
            { value: "api-old", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: { cost: { min: 1, max: 7 }, spans: { min: 2, max: 9 } },
    },
    "none:batch:runs": {
      categoricals: {
        evaluatorStatus: {
          values: [
            { value: "processed", count: 2 },
            { value: "error", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorVerdict: {
          values: [
            { value: "error", count: 1 },
            { value: "fail", count: 1 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 3,
        },
        evaluatorLabel: {
          values: [
            { value: "bad", count: 1 },
            { value: "good", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { evaluatorScore: { min: 0.1, max: 0.9 } },
    },
    "none:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "chain", count: 1 },
            { value: "llm", count: 1 },
            { value: "tool", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: {},
    },
    "none:model": {
      values: [
        { value: "gpt-4", count: 2 },
        { value: "claude", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:model:gpt": {
      values: [
        { value: "gpt-4", count: 2 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "none:label": {
      values: [
        { value: "bad", count: 1 },
        { value: "good", count: 1 },
      ],
      totalDistinct: 2,
    },
    "none:discrete:spans": {
      values: [
        { value: 2, count: 1 },
        { value: 5, count: 1 },
        { value: 9, count: 1 },
      ],
      distinctCount: 3,
    },
    "none:range:cost": { min: 1, max: 7 },
    "none:range:score": { min: 0.1, max: 0.9 },
    "svc:batch:summaries": {
      categoricals: {
        status: { values: [{ value: "ok", count: 2 }], totalDistinct: 1 },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-old", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { cost: { min: 1, max: 7 }, spans: { min: 2, max: 9 } },
    },
    "svc:batch:runs": {
      categoricals: {
        evaluatorStatus: { values: [{ value: "processed", count: 2 }], totalDistinct: 1 },
        evaluatorVerdict: {
          values: [
            { value: "fail", count: 1 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorLabel: {
          values: [
            { value: "bad", count: 1 },
            { value: "good", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { evaluatorScore: { min: 0.1, max: 0.9 } },
    },
    "svc:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "chain", count: 1 },
            { value: "llm", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: {},
    },
    "svc:model": {
      values: [
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:model:gpt": {
      values: [
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:label": {
      values: [
        { value: "bad", count: 1 },
        { value: "good", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:discrete:spans": {
      values: [
        { value: 2, count: 1 },
        { value: 9, count: 1 },
      ],
      distinctCount: 2,
    },
    "svc:range:cost": { min: 1, max: 7 },
    "svc:range:score": { min: 0.1, max: 0.9 },
    "span:batch:summaries": {
      categoricals: {
        status: { values: [{ value: "ok", count: 2 }], totalDistinct: 1 },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-old", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { cost: { min: 1, max: 7 }, spans: { min: 2, max: 9 } },
    },
    "span:batch:runs": {
      categoricals: {
        evaluatorStatus: { values: [{ value: "processed", count: 2 }], totalDistinct: 1 },
        evaluatorVerdict: {
          values: [
            { value: "fail", count: 1 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorLabel: {
          values: [
            { value: "bad", count: 1 },
            { value: "good", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { evaluatorScore: { min: 0.1, max: 0.9 } },
    },
    "span:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "chain", count: 1 },
            { value: "llm", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: {},
    },
    "span:model": {
      values: [
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:model:gpt": {
      values: [
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:label": {
      values: [
        { value: "bad", count: 1 },
        { value: "good", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:discrete:spans": {
      values: [
        { value: 2, count: 1 },
        { value: 9, count: 1 },
      ],
      distinctCount: 2,
    },
    "span:range:cost": { min: 1, max: 7 },
    "span:range:score": { min: 0.1, max: 0.9 },
  },
  "an aggregate's tenant set": {
    "none:batch:summaries": {
      categoricals: {
        status: {
          values: [
            { value: "ok", count: 3 },
            { value: "error", count: 1 },
          ],
          totalDistinct: 2,
        },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-agg", count: 1 },
            { value: "api-b", count: 1 },
            { value: "api-old", count: 1 },
          ],
          totalDistinct: 4,
        },
      },
      ranges: { cost: { min: 1, max: 7 }, spans: { min: 2, max: 9 } },
    },
    "none:batch:runs": {
      categoricals: {
        evaluatorStatus: {
          values: [
            { value: "processed", count: 3 },
            { value: "error", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorVerdict: {
          values: [
            { value: "fail", count: 2 },
            { value: "error", count: 1 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 3,
        },
        evaluatorLabel: {
          values: [
            { value: "bad", count: 1 },
            { value: "good", count: 1 },
            { value: "meh", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: { evaluatorScore: { min: 0.1, max: 0.9 } },
    },
    "none:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "agent", count: 1 },
            { value: "chain", count: 1 },
            { value: "llm", count: 1 },
            { value: "tool", count: 1 },
          ],
          totalDistinct: 4,
        },
      },
      ranges: {},
    },
    "none:model": {
      values: [
        { value: "claude", count: 2 },
        { value: "gpt-4", count: 2 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:model:gpt": {
      values: [
        { value: "gpt-4", count: 2 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "none:label": {
      values: [
        { value: "bad", count: 1 },
        { value: "good", count: 1 },
        { value: "meh", count: 1 },
      ],
      totalDistinct: 3,
    },
    "none:discrete:spans": {
      values: [
        { value: 2, count: 2 },
        { value: 5, count: 1 },
        { value: 9, count: 1 },
      ],
      distinctCount: 3,
    },
    "none:range:cost": { min: 1, max: 7 },
    "none:range:score": { min: 0.1, max: 0.9 },
    "svc:batch:summaries": {
      categoricals: {
        status: { values: [{ value: "ok", count: 3 }], totalDistinct: 1 },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-agg", count: 1 },
            { value: "api-old", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: { cost: { min: 1, max: 7 }, spans: { min: 2, max: 9 } },
    },
    "svc:batch:runs": {
      categoricals: {
        evaluatorStatus: { values: [{ value: "processed", count: 3 }], totalDistinct: 1 },
        evaluatorVerdict: {
          values: [
            { value: "fail", count: 2 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorLabel: {
          values: [
            { value: "bad", count: 1 },
            { value: "good", count: 1 },
            { value: "meh", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: { evaluatorScore: { min: 0.1, max: 0.9 } },
    },
    "svc:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "agent", count: 1 },
            { value: "chain", count: 1 },
            { value: "llm", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: {},
    },
    "svc:model": {
      values: [
        { value: "claude", count: 1 },
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 3,
    },
    "svc:model:gpt": {
      values: [
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:label": {
      values: [
        { value: "bad", count: 1 },
        { value: "good", count: 1 },
        { value: "meh", count: 1 },
      ],
      totalDistinct: 3,
    },
    "svc:discrete:spans": {
      values: [
        { value: 2, count: 2 },
        { value: 9, count: 1 },
      ],
      distinctCount: 2,
    },
    "svc:range:cost": { min: 1, max: 7 },
    "svc:range:score": { min: 0.1, max: 0.9 },
    "span:batch:summaries": {
      categoricals: {
        status: { values: [{ value: "ok", count: 3 }], totalDistinct: 1 },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-agg", count: 1 },
            { value: "api-old", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: { cost: { min: 1, max: 7 }, spans: { min: 2, max: 9 } },
    },
    "span:batch:runs": {
      categoricals: {
        evaluatorStatus: { values: [{ value: "processed", count: 3 }], totalDistinct: 1 },
        evaluatorVerdict: {
          values: [
            { value: "fail", count: 2 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorLabel: {
          values: [
            { value: "bad", count: 1 },
            { value: "good", count: 1 },
            { value: "meh", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: { evaluatorScore: { min: 0.1, max: 0.9 } },
    },
    "span:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "agent", count: 1 },
            { value: "chain", count: 1 },
            { value: "llm", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: {},
    },
    "span:model": {
      values: [
        { value: "claude", count: 1 },
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 3,
    },
    "span:model:gpt": {
      values: [
        { value: "gpt-4", count: 1 },
        { value: "gpt-old", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:label": {
      values: [
        { value: "bad", count: 1 },
        { value: "good", count: 1 },
        { value: "meh", count: 1 },
      ],
      totalDistinct: 3,
    },
    "span:discrete:spans": {
      values: [
        { value: 2, count: 2 },
        { value: 9, count: 1 },
      ],
      distinctCount: 2,
    },
    "span:range:cost": { min: 1, max: 7 },
    "span:range:score": { min: 0.1, max: 0.9 },
  },
  "a windowed share": {
    "none:batch:summaries": {
      categoricals: {
        status: {
          values: [
            { value: "ok", count: 2 },
            { value: "error", count: 1 },
          ],
          totalDistinct: 2,
        },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-agg", count: 1 },
            { value: "api-b", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: { cost: { min: 1, max: 3 }, spans: { min: 2, max: 5 } },
    },
    "none:batch:runs": {
      categoricals: {
        evaluatorStatus: {
          values: [
            { value: "processed", count: 2 },
            { value: "error", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorVerdict: {
          values: [
            { value: "error", count: 1 },
            { value: "fail", count: 1 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 3,
        },
        evaluatorLabel: {
          values: [
            { value: "good", count: 1 },
            { value: "meh", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { evaluatorScore: { min: 0.5, max: 0.9 } },
    },
    "none:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "agent", count: 1 },
            { value: "llm", count: 1 },
            { value: "tool", count: 1 },
          ],
          totalDistinct: 3,
        },
      },
      ranges: {},
    },
    "none:model": {
      values: [
        { value: "claude", count: 2 },
        { value: "gpt-4", count: 2 },
      ],
      totalDistinct: 2,
    },
    "none:model:gpt": { values: [{ value: "gpt-4", count: 2 }], totalDistinct: 1 },
    "none:label": {
      values: [
        { value: "good", count: 1 },
        { value: "meh", count: 1 },
      ],
      totalDistinct: 2,
    },
    "none:discrete:spans": {
      values: [
        { value: 2, count: 2 },
        { value: 5, count: 1 },
      ],
      distinctCount: 2,
    },
    "none:range:cost": { min: 1, max: 3 },
    "none:range:score": { min: 0.5, max: 0.9 },
    "svc:batch:summaries": {
      categoricals: {
        status: { values: [{ value: "ok", count: 2 }], totalDistinct: 1 },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-agg", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { cost: { min: 1, max: 2 }, spans: { min: 2, max: 2 } },
    },
    "svc:batch:runs": {
      categoricals: {
        evaluatorStatus: { values: [{ value: "processed", count: 2 }], totalDistinct: 1 },
        evaluatorVerdict: {
          values: [
            { value: "fail", count: 1 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorLabel: {
          values: [
            { value: "good", count: 1 },
            { value: "meh", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { evaluatorScore: { min: 0.5, max: 0.9 } },
    },
    "svc:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "agent", count: 1 },
            { value: "llm", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: {},
    },
    "svc:model": {
      values: [
        { value: "claude", count: 1 },
        { value: "gpt-4", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:model:gpt": { values: [{ value: "gpt-4", count: 1 }], totalDistinct: 1 },
    "svc:label": {
      values: [
        { value: "good", count: 1 },
        { value: "meh", count: 1 },
      ],
      totalDistinct: 2,
    },
    "svc:discrete:spans": { values: [{ value: 2, count: 2 }], distinctCount: 1 },
    "svc:range:cost": { min: 1, max: 2 },
    "svc:range:score": { min: 0.5, max: 0.9 },
    "span:batch:summaries": {
      categoricals: {
        status: { values: [{ value: "ok", count: 2 }], totalDistinct: 1 },
        service: {
          values: [
            { value: "api-a", count: 1 },
            { value: "api-agg", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { cost: { min: 1, max: 2 }, spans: { min: 2, max: 2 } },
    },
    "span:batch:runs": {
      categoricals: {
        evaluatorStatus: { values: [{ value: "processed", count: 2 }], totalDistinct: 1 },
        evaluatorVerdict: {
          values: [
            { value: "fail", count: 1 },
            { value: "pass", count: 1 },
          ],
          totalDistinct: 2,
        },
        evaluatorLabel: {
          values: [
            { value: "good", count: 1 },
            { value: "meh", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: { evaluatorScore: { min: 0.5, max: 0.9 } },
    },
    "span:batch:spans": {
      categoricals: {
        spanType: {
          values: [
            { value: "agent", count: 1 },
            { value: "llm", count: 1 },
          ],
          totalDistinct: 2,
        },
      },
      ranges: {},
    },
    "span:model": {
      values: [
        { value: "claude", count: 1 },
        { value: "gpt-4", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:model:gpt": { values: [{ value: "gpt-4", count: 1 }], totalDistinct: 1 },
    "span:label": {
      values: [
        { value: "good", count: 1 },
        { value: "meh", count: 1 },
      ],
      totalDistinct: 2,
    },
    "span:discrete:spans": { values: [{ value: 2, count: 2 }], distinctCount: 1 },
    "span:range:cost": { min: 1, max: 2 },
    "span:range:score": { min: 0.5, max: 0.9 },
  },
};

let ch: MigratedAppReaderClickHouse;
let repo: TraceListClickHouseRepository;

/** Each facet's values most frequent first, ties in value order. */
function normalised(answer: unknown): unknown {
  if (Array.isArray(answer) || answer === null || typeof answer !== "object") return answer;
  return Object.fromEntries(
    Object.entries(answer).map(([key, value]) => [
      key,
      key === "values" && Array.isArray(value)
        ? (value as { value: string | number; count: number }[]).toSorted(
            (a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)),
          )
        : normalised(value),
    ]),
  );
}

/** Every facet read the sidebar makes, under one proof and one filter. */
async function facetAnswers(authorization: Authorization, filter: FilterName) {
  const compile =
    filter === "none"
      ? {}
      : {
          compileFilter: traceFilterCompileFor({
            queryText: FILTERS[filter],
            timeRange: seed.window,
          }),
        };
  const scan = { authorization, timeRange: seed.window, ...compile };
  const batched = (
    table: "trace_summaries" | "evaluation_runs" | "stored_spans",
    categoricalKeys: string[],
    rangeKeys: string[],
  ) => repo.findBatchedFacets({ ...scan, table, categoricalKeys, rangeKeys, topN: 50 });
  const page = { limit: 50, offset: 0 };
  return {
    [`${filter}:batch:summaries`]: await batched(
      "trace_summaries",
      ["status", "service"],
      ["cost", "spans"],
    ),
    [`${filter}:batch:runs`]: await batched(
      "evaluation_runs",
      ["evaluatorStatus", "evaluatorVerdict", "evaluatorLabel"],
      ["evaluatorScore"],
    ),
    [`${filter}:batch:spans`]: await batched("stored_spans", ["spanType"], []),
    [`${filter}:model`]: await repo.findCategoricalFacet({
      ...scan,
      ...page,
      table: "trace_summaries",
      facetKey: "model",
    }),
    [`${filter}:model:gpt`]: await repo.findCategoricalFacet({
      ...scan,
      ...page,
      table: "trace_summaries",
      facetKey: "model",
      prefix: "GPT",
    }),
    [`${filter}:label`]: await repo.findCategoricalFacet({
      ...scan,
      ...page,
      table: "evaluation_runs",
      facetKey: "evaluatorLabel",
    }),
    [`${filter}:discrete:spans`]: await repo.findDiscreteValues({
      ...scan,
      table: "trace_summaries",
      facetKey: "spans",
      limit: 50,
    }),
    [`${filter}:range:cost`]: await repo.findRangeStatsForTable({
      ...scan,
      table: "trace_summaries",
      facetKey: "cost",
    }),
    [`${filter}:range:score`]: await repo.findRangeStatsForTable({
      ...scan,
      table: "evaluation_runs",
      facetKey: "evaluatorScore",
    }),
  };
}

beforeAll(async () => {
  ch = await startMigratedAppReaderClickHouse({
    suite: "trace-facets",
    indexes: TRACE_ID_INDEXES,
    environment: process.env,
  });
  await seedFacetRows({
    seed,
    now: NOW,
    insert: (table, values) => ch.admin.insert({ table, values, format: "JSONEachRow" }),
  });
  repo = TraceListClickHouseRepository.create({
    reader: ch.reader,
  });
}, 300_000);

afterAll(async () => {
  await ch?.close();
});

describe("the facet reads on built statements", () => {
  /** @scenario "Facet counts keep main's answers under each scope" */
  it.each(SCOPES)("counts every facet under %s as main does", async (name, proof) => {
    for (const filter of Object.keys(FILTERS) as FilterName[]) {
      const built = normalised(await facetAnswers(proof(), filter));
      const main = Object.fromEntries(
        Object.entries(MAIN[name]!).filter(([key]) => key.startsWith(`${filter}:`)),
      );
      expect(built).toEqual(main);
    }
  });

  /** @scenario "Under a windowed share the facets count the traces the list shows" */
  it("counts under a windowed share the traces the list returns for the same filter", async () => {
    const proof = SCOPES[2]![1];
    const compileFilter = traceFilterCompileFor({
      queryText: FILTERS.span,
      timeRange: seed.window,
    });
    const list = await repo.listAll({
      authorization: proof(),
      timeRange: seed.window,
      sort: { column: "OccurredAt", direction: "desc" },
      limit: 50,
      compileFilter,
    });
    const facets = await repo.findBatchedFacets({
      authorization: proof(),
      timeRange: seed.window,
      table: "trace_summaries",
      categoricalKeys: ["service"],
      rangeKeys: [],
      topN: 50,
      compileFilter,
    });

    const listed = list.rows
      .map((row) => row.attributes["service.name"])
      .toSorted((a, b) => String(a).localeCompare(String(b)));
    const counted = facets.categoricals.service!.values.flatMap((each) =>
      Array.from({ length: each.count }, () => each.value),
    );
    expect(counted.toSorted((a, b) => a.localeCompare(b))).toEqual(listed);
    expect(listed).toEqual(["api-a", "api-agg"]);
  });
});

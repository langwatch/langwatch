/**
 * One reference door for both query languages, pure and therefore cacheable:
 * what a field actually holds is tenant data, so the document names
 * `GET /api/traces/facets` rather than inlining it. See ADR-154.
 * @see specs/analytics/query-reference.feature
 */
import {
  QUERY_REFERENCE_VERSION,
  type LangWatchQLProtections,
  type LangWatchQLSchema,
  type QueryExampleIntent,
  type QueryReference,
  type QueryReferenceDecision,
  type QueryReferenceDynamicPrefix,
  type QueryReferenceEndpoint,
  type QueryReferenceExample,
  type QueryReferenceFilterField,
} from "@langwatch/analytics-contract";
import {
  DYNAMIC_PREFIXES,
  FIELD_VALUES,
  QUERY_SYNTAX_DOC,
  SEARCH_FIELDS,
} from "@langwatch/trace-contract";

import { LWQL_EXAMPLE_DATABASE, LWQL_EXAMPLES } from "./langwatch-ql-examples.rules.ts";
import { heldFieldProtections, type FieldProtection } from "./lwql-field-protection.rules.ts";

/**
 * One worked trace filter query, as the filter language publishes it. Structural
 * rather than imported while `TRACE_FILTER_EXAMPLES` is trace's to publish.
 */
export interface QueryReferenceTraceFilterExample {
  readonly id: string;
  readonly title: string;
  readonly intent: QueryExampleIntent;
  readonly tags: readonly string[];
  readonly text: string;
  readonly notes?: string;
}

const LWQL_ENDPOINTS: readonly QueryReferenceEndpoint[] = [
  {
    method: "POST",
    path: "/api/v1/query",
    description:
      "Run one read-only SELECT. The body's `sql` is executed as written and never rewritten.",
  },
  {
    method: "GET",
    path: "/api/v1/query/schema",
    description:
      "The views and columns this key may query, each column's type and the permissions that unlock it.",
  },
  {
    method: "GET",
    path: "/api/v1/query/reference",
    description: "This document.",
  },
];

const TRACE_FILTER_ENDPOINTS: readonly QueryReferenceEndpoint[] = [
  {
    method: "POST",
    path: "/api/traces/search",
    description:
      "Search traces. Send the filter string as `filter`; it is combined with `query`, `filters` and `traceIds`.",
  },
  {
    method: "GET",
    path: "/api/traces/facets",
    description:
      "What the fields hold. Without `field`, every facet with its top values; with `field`, that field's values and counts.",
  },
  {
    method: "GET",
    path: "/api/traces/{traceId}",
    description: "One trace in full, or as an LLM-readable digest with `format=digest`.",
  },
];

/**
 * Which language answers which question — the one part of this document that is
 * advice rather than a projection, and the part a reader needs first. Ordered
 * from the most common question to the least.
 */
const DECISION_TABLE: readonly QueryReferenceDecision[] = [
  {
    when: "Find the traces matching a condition, and read them",
    use: "Trace filter, through POST /api/traces/search",
    why: "It returns whole traces with their spans and evaluations. LangWatchQL returns columns, not traces.",
  },
  {
    when: "Filter on an attribute you send yourself, or on an evaluator's verdict",
    use: "Trace filter, with a `trace.attribute.` / `span.attribute.` / `event.attribute.` prefix or an evaluator field",
    why: "The filter reaches attribute maps and span events by key. In LangWatchQL an attribute is a map lookup on one dataset and a span event is not exposed at all.",
  },
  {
    when: "Free text anywhere in the captured input or output",
    use: "Trace filter, as a bare term or a quoted phrase",
    why: "The search is backed by a text index. The same question in SQL is a scan of the widest columns there are.",
  },
  {
    when: "A count, a rate, a sum, a percentile, or any of them over time",
    use: "LangWatchQL, through POST /api/v1/query",
    why: "One aggregate answers what would otherwise be a page-by-page walk of the whole result.",
  },
  {
    when: "Group by model, evaluator, user, conversation or topic",
    use: "LangWatchQL over the metrics views",
    why: "`trace_metrics` and the per-minute rollups carry those identities already grouped. The filter has no GROUP BY.",
  },
  {
    when: "Join traces to their spans or their evaluations",
    use: "LangWatchQL, with the time column bounded on both sides",
    why: "It is the only language with joins.",
  },
  {
    when: "Export many rows for training or offline analysis",
    use: "LangWatchQL with the keyset paging shape, or POST /api/traces/search with its scroll cursor",
    why: "Both page without re-reading. Pick LangWatchQL when you want columns, the search when you want whole traces.",
  },
  {
    when: "You do not know how a value is spelled",
    use: "GET /api/traces/facets for that field",
    why: "The reference lists the fields and their static vocabularies. Only the facets endpoint knows what this project actually holds.",
  },
];

/** The field's value set can be listed by the facets endpoint. */
const FACETABLE_VALUE_TYPES: ReadonlySet<QueryReferenceFilterField["valueType"]> = new Set([
  "categorical",
  "range",
]);

/**
 * Older spellings, keyed by the canonical prefix they resolve to. The two
 * legacy forms the translator still accepts, which trace's filter compiler
 * spells as `TRACE_ATTRIBUTE_PREFIX_LEGACY` and `EVENT_ATTRIBUTE_PREFIX_LEGACY`.
 */
const PREFIX_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "trace.attribute.": ["attribute."],
  "event.attribute.": ["event."],
};

export function describeFilterFields(): readonly QueryReferenceFilterField[] {
  return Object.entries(SEARCH_FIELDS).map(([name, meta]) => ({
    name,
    label: meta.label,
    valueType: meta.valueType,
    group: meta.group ?? null,
    facetable: meta.facetField !== undefined && FACETABLE_VALUE_TYPES.has(meta.valueType),
    knownValues: FIELD_VALUES[name] ?? [],
  }));
}

export function describeDynamicPrefixes(): readonly QueryReferenceDynamicPrefix[] {
  return DYNAMIC_PREFIXES.map((prefix) => ({
    prefix: prefix.prefix,
    label: prefix.label,
    description: prefix.description,
    aliases: PREFIX_ALIASES[prefix.prefix] ?? [],
  }));
}

function isAvailable(input: {
  gates: readonly FieldProtection[];
  held: ReadonlySet<FieldProtection>;
}): boolean {
  return input.gates.every((gate) => input.held.has(gate));
}

/**
 * The statement, qualified with the database this deployment actually serves.
 * The library writes the production spelling, and a deployment serving the same
 * views elsewhere would otherwise publish a database its callers cannot reach.
 */
function qualify(input: { sql: string; database: string }): string {
  if (input.database === LWQL_EXAMPLE_DATABASE) return input.sql;

  return input.sql.split(`${LWQL_EXAMPLE_DATABASE}.`).join(`${input.database}.`);
}

function describeExamples(input: {
  held: ReadonlySet<FieldProtection>;
  lwqlEnabled: boolean;
  database: string;
  traceFilterExamples: readonly QueryReferenceTraceFilterExample[];
}): readonly QueryReferenceExample[] {
  const { held, lwqlEnabled, database, traceFilterExamples } = input;
  const statements: QueryReferenceExample[] = LWQL_EXAMPLES.map((example) => ({
    id: example.id,
    title: example.title,
    intent: example.intent,
    language: "lwql" as const,
    tags: example.tags,
    text: qualify({ sql: example.sql, database }),
    parameters: example.parameters,
    requires: { gates: example.gates, functions: [] },
    // Two ways a SQL example is not runnable here: a column it reads is
    // withheld from this caller, or the caller reaches no LangWatchQL at all.
    available: lwqlEnabled && isAvailable({ gates: example.gates, held }),
    ...(example.notes ? { notes: example.notes } : {}),
  }));
  const filters: QueryReferenceExample[] = traceFilterExamples.map((example) => ({
    id: example.id,
    title: example.title,
    intent: example.intent,
    language: "trace-filter" as const,
    tags: example.tags,
    text: example.text,
    parameters: [],
    // A filter string names no column, so there is no column gate to hold. What
    // the RESULT shows is redacted by the read path, as the explorer's is.
    requires: { gates: [], functions: [] },
    available: true,
    ...(example.notes ? { notes: example.notes } : {}),
  }));

  return [...statements, ...filters];
}

/**
 * The reference for one caller. Whether the caller reaches LangWatchQL is
 * passed in rather than asked here, which is what keeps this pure and lets a
 * test build the document both ways without a credential.
 */
export function buildQueryReference(input: {
  protections: LangWatchQLProtections;
  lwqlEnabled: boolean;
  database: string;
  schema: LangWatchQLSchema;
  limits: {
    maxStatementLength: number;
    maxRowsReturned: number;
    maxResultBytes: number;
    maxExecutionTimeSeconds: number;
  };
  traceFilterExamples: readonly QueryReferenceTraceFilterExample[];
}): QueryReference {
  const { protections, lwqlEnabled, database, schema, limits, traceFilterExamples } = input;

  return {
    version: QUERY_REFERENCE_VERSION,
    lwql: {
      enabled: lwqlEnabled,
      schema,
      limits: {
        ...limits,
        pagination:
          "The endpoint has no cursor. Page by writing a keyset predicate into the statement and rebinding its parameters; see the example tagged `paging`.",
      },
      endpoints: LWQL_ENDPOINTS,
    },
    traceFilter: {
      syntax: QUERY_SYNTAX_DOC,
      fields: describeFilterFields(),
      dynamicPrefixes: describeDynamicPrefixes(),
      endpoints: TRACE_FILTER_ENDPOINTS,
    },
    examples: describeExamples({
      held: heldFieldProtections(protections),
      lwqlEnabled,
      database,
      traceFilterExamples,
    }),
    decisionTable: DECISION_TABLE,
  };
}

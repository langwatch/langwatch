/**
 * One reference door for both of LangWatch's query languages.
 *
 * LangWatch answers two of them, and they are not alternatives. LangWatchQL is
 * SQL over the analytics views: counts, rates, groupings, time series,
 * joins. The trace filter is a Lucene-flavored string over one trace list:
 * named fields, open-ended attribute namespaces, evaluator verdicts, free text.
 * A question belongs to one or the other, and picking wrong is expensive — an
 * agent that only knows the filter writes twelve searches where one `GROUP BY`
 * would do, and an agent that only knows the SQL cannot find a trace by an
 * attribute key at all.
 *
 * Both languages already published their pieces, in different places and to
 * different readers: the schema endpoint to an API caller, `SEARCH_FIELDS` to
 * the browser, `QUERY_SYNTAX_DOC` to the Trace Explorer's AI mode, and nothing
 * anywhere to a CLI or an MCP client. This assembles them into one document, so
 * there is one thing to fetch and one place a new field has to be added.
 *
 * ## Pure, and therefore cacheable
 *
 * It reads the LangWatchQL catalog, the filter field registry, the example
 * libraries and the caller's `Protections`. It reads no tenant data and makes
 * no database call, which is what lets the endpoint answer it from memory.
 *
 * The values a field actually holds are the deliberate omission. They are
 * tenant data, they change under the caller, and reading them costs about
 * thirty ClickHouse queries — so they live at `GET /api/traces/facets` and this
 * document names that endpoint instead of inlining a snapshot of it.
 *
 * ## An unavailable example stays published
 *
 * The same rule the schema endpoint applies to a withheld column: an example
 * whose columns need a permission the caller lacks is published with
 * `available: false` and its `requires.gates` intact. Hiding it would hide the
 * one fact that makes the refusal actionable — which permission to ask for.
 *
 * @see ../lwql/schema.ts — the LangWatchQL half this embeds
 * @see ../../app-layer/traces/query-language/metadata.ts — the filter half
 * @see specs/analytics/query-reference.feature
 */

import {
  EVENT_ATTRIBUTE_PREFIX,
  EVENT_ATTRIBUTE_PREFIX_LEGACY,
  TRACE_ATTRIBUTE_PREFIX,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
} from "../../app-layer/traces/filter-to-clickhouse/value-helpers";
import {
  type QueryExampleIntent,
  TRACE_FILTER_EXAMPLES,
} from "../../app-layer/traces/query-language/examples";
import { QUERY_SYNTAX_DOC } from "../../app-layer/traces/query-language/grammar";
import {
  DYNAMIC_PREFIXES,
  FIELD_VALUES,
  SEARCH_FIELDS,
  type SearchFieldGroup,
} from "../../app-layer/traces/query-language/metadata";
import type { FieldProtection } from "../../traces/projection/catalog";
import type { Protections } from "../../traces/protections";
import { LWQL_VIEW_CATALOG } from "../lwql/catalog/lwqlViews";
import { lwqlHeldPermissions } from "../lwql/catalog/types";
import { LWQL_EXAMPLES } from "../lwql/examples";
import { DEFAULT_LWQL_RESULT_LIMITS } from "../lwql/executor";
import { DEFAULT_LWQL_RESOURCE_LIMITS, MAX_LWQL_LENGTH } from "../lwql/limits";
import { DEFAULT_LWQL_DATABASE } from "../lwql/lwql.service";
import {
  describeLangWatchQLSchema,
  type LangWatchQLSchema,
} from "../lwql/schema";

/**
 * The document's shape version.
 *
 * Bumped when a consumer would have to change to keep reading it, never when
 * the content changes: a new example, a new field and a new dataset all arrive
 * under the same version, which is the point of publishing them rather than
 * hard-coding them.
 */
export const QUERY_REFERENCE_VERSION = "1";

/** Which language an example is written in. */
export type QueryLanguage = "lwql" | "trace-filter";

/** One HTTP door, so a reader never has to guess the path or the verb. */
export interface QueryReferenceEndpoint {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly description: string;
}

/** One trace filter field, as the reference publishes it. */
export interface QueryReferenceFilterField {
  /** The name a caller writes before the colon. */
  readonly name: string;
  readonly label: string;
  readonly valueType: "categorical" | "range" | "text" | "existence";
  /** Where the field sits in the product's own grouping. */
  readonly group: SearchFieldGroup | null;
  /**
   * Whether the facets endpoint can list this field's values.
   *
   * False for a free-text or existence field: there is no value set to list,
   * and a caller told otherwise spends a round trip finding that out.
   */
  readonly facetable: boolean;
  /**
   * The values this field is known to take, when they come from a closed set.
   *
   * Static vocabulary only — statuses, origins, verdicts. Never a value read
   * from the project's traces: those are tenant data and belong to the facets
   * endpoint, which is why an empty list here means "open set", not "no
   * values".
   */
  readonly knownValues: readonly string[];
}

/** One open-ended attribute namespace. */
export interface QueryReferenceDynamicPrefix {
  readonly prefix: string;
  readonly label: string;
  readonly description: string;
  /** Older spellings the translator still accepts for this namespace. */
  readonly aliases: readonly string[];
}

/** One worked query, in either language. */
export interface QueryReferenceExample {
  readonly id: string;
  readonly title: string;
  readonly intent: QueryExampleIntent;
  readonly language: QueryLanguage;
  readonly tags: readonly string[];
  /** The statement or filter string, exactly as it should be sent. */
  readonly text: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly description: string;
  }[];
  readonly requires: {
    readonly gates: readonly FieldProtection[];
    /**
     * App-side LangWatchQL functions the statement calls.
     *
     * Always empty today: the function catalog ships separately, and an example
     * naming one would be an example the validator refuses. The field is here
     * so a consumer parses one shape before and after that lands.
     */
    readonly functions: readonly string[];
  };
  /** Whether this caller's permissions let them run it as written. */
  readonly available: boolean;
  readonly notes?: string;
}

/** One row of the "which language answers this" table. */
export interface QueryReferenceDecision {
  /** The kind of question, in the reader's words. */
  readonly when: string;
  /** What to reach for. */
  readonly use: string;
  /** Why that one and not the other. */
  readonly why: string;
}

/** What the LangWatchQL half of the reference publishes. */
export interface QueryReferenceLangWatchQL {
  /**
   * Whether this caller can use the LangWatchQL half here.
   *
   * One flag for both reasons it can be closed: the project has no such
   * surface, or the credential does not hold the permission that opens it. A
   * consumer branches on the same thing either way, and the half is described
   * as unavailable rather than as absent so a reader is never left wondering
   * whether SQL exists at all.
   */
  readonly enabled: boolean;
  /** Empty while `enabled` is false: a catalog nobody here can query. */
  readonly schema: LangWatchQLSchema;
  readonly limits: {
    readonly maxStatementLength: number;
    readonly maxRowsReturned: number;
    readonly maxResultBytes: number;
    readonly maxExecutionTimeSeconds: number;
    /** No pagination: the statement pages itself. See the keyset example. */
    readonly pagination: string;
  };
  readonly endpoints: readonly QueryReferenceEndpoint[];
}

/** What the trace filter half publishes. */
export interface QueryReferenceTraceFilter {
  /** The language's syntax, as markdown. */
  readonly syntax: string;
  readonly fields: readonly QueryReferenceFilterField[];
  readonly dynamicPrefixes: readonly QueryReferenceDynamicPrefix[];
  readonly endpoints: readonly QueryReferenceEndpoint[];
}

/** The whole document. */
export interface QueryReference {
  readonly version: string;
  readonly lwql: QueryReferenceLangWatchQL;
  readonly traceFilter: QueryReferenceTraceFilter;
  readonly examples: readonly QueryReferenceExample[];
  readonly decisionTable: readonly QueryReferenceDecision[];
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
    description:
      "One trace in full, or as an LLM-readable digest with `format=digest`.",
  },
];

/**
 * Which language answers which question.
 *
 * The one part of this document that is advice rather than a projection, and
 * the part a reader needs first: everything else describes a language, and this
 * says which language to describe to yourself. Ordered from the most common
 * question to the least.
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
const FACETABLE_VALUE_TYPES: ReadonlySet<
  QueryReferenceFilterField["valueType"]
> = new Set(["categorical", "range"]);

function describeFilterFields(): readonly QueryReferenceFilterField[] {
  return Object.entries(SEARCH_FIELDS).map(([name, meta]) => ({
    name,
    label: meta.label,
    valueType: meta.valueType,
    group: meta.group ?? null,
    facetable:
      meta.facetField !== undefined &&
      FACETABLE_VALUE_TYPES.has(meta.valueType),
    knownValues: FIELD_VALUES[name] ?? [],
  }));
}

/**
 * Older spellings, keyed by the canonical prefix they resolve to.
 *
 * Read off the translator's own constants rather than re-listed, so a namespace
 * that gains or loses a legacy spelling cannot leave this saying otherwise.
 */
const PREFIX_ALIASES: Readonly<Record<string, readonly string[]>> = {
  [TRACE_ATTRIBUTE_PREFIX]: [TRACE_ATTRIBUTE_PREFIX_LEGACY],
  [EVENT_ATTRIBUTE_PREFIX]: [EVENT_ATTRIBUTE_PREFIX_LEGACY],
};

function describeDynamicPrefixes(): readonly QueryReferenceDynamicPrefix[] {
  return DYNAMIC_PREFIXES.map((prefix) => ({
    prefix: prefix.prefix,
    label: prefix.label,
    description: prefix.description,
    aliases: PREFIX_ALIASES[prefix.prefix] ?? [],
  }));
}

function isAvailable({
  gates,
  held,
}: {
  gates: readonly FieldProtection[];
  held: ReadonlySet<FieldProtection>;
}): boolean {
  return gates.every((gate) => held.has(gate));
}

/**
 * The statement, qualified with the database this deployment actually serves.
 *
 * The library writes `analytics.<view>`, which is the name in production and
 * the name a reader should learn. A deployment can serve the same views out of
 * another database, and there a published example would name a database the
 * caller cannot reach. The schema section already publishes every dataset under
 * the deployment's own qualifier; this keeps the examples agreeing with it.
 */
function qualify({ sql, database }: { sql: string; database: string }): string {
  if (database === DEFAULT_LWQL_DATABASE) return sql;
  return sql.split(`${DEFAULT_LWQL_DATABASE}.`).join(`${database}.`);
}

function describeExamples({
  held,
  lwqlEnabled,
  database,
}: {
  held: ReadonlySet<FieldProtection>;
  lwqlEnabled: boolean;
  database: string;
}): readonly QueryReferenceExample[] {
  const lwql: QueryReferenceExample[] = LWQL_EXAMPLES.map((example) => ({
    id: example.id,
    title: example.title,
    intent: example.intent,
    language: "lwql" as const,
    tags: example.tags,
    text: qualify({ sql: example.sql, database }),
    parameters: example.parameters,
    requires: { gates: example.gates, functions: [] },
    // Two ways a SQL example is not runnable here: a column it reads is
    // withheld from this caller, or the project has no LangWatchQL surface at
    // all. A consumer reading `available` reads one answer, not one of them.
    available: lwqlEnabled && isAvailable({ gates: example.gates, held }),
    ...(example.notes ? { notes: example.notes } : {}),
  }));
  const filters: QueryReferenceExample[] = TRACE_FILTER_EXAMPLES.map(
    (example) => ({
      id: example.id,
      title: example.title,
      intent: example.intent,
      language: "trace-filter" as const,
      tags: example.tags,
      text: example.text,
      parameters: [],
      // A filter string names no column, so there is no column gate to hold.
      // What the RESULT shows is redacted by the read path, the same way the
      // Trace Explorer's own results are.
      requires: { gates: [], functions: [] },
      available: true,
      ...(example.notes ? { notes: example.notes } : {}),
    }),
  );
  return [...lwql, ...filters];
}

/**
 * The reference for one caller.
 *
 * `lwqlEnabled` is passed in rather than read here, because the flag check is a
 * database read and this function is the pure part: the endpoint asks
 * `lwqlEnabled()` once and hands the answer down, which is also what lets a
 * test build the document both ways without a flag store.
 */
export function describeQueryReference({
  protections,
  lwqlEnabled,
  database,
}: {
  protections: Protections;
  lwqlEnabled: boolean;
  database: string;
}): QueryReference {
  const held = lwqlHeldPermissions(protections);
  return {
    version: QUERY_REFERENCE_VERSION,
    lwql: {
      enabled: lwqlEnabled,
      // Withheld with the surface, not merely flagged. `/schema` refuses a
      // caller who cannot query, and this document embeds the same catalog:
      // publishing it here would be that door standing open next to the one
      // that is shut.
      schema: lwqlEnabled
        ? describeLangWatchQLSchema({
            database,
            protections,
            views: LWQL_VIEW_CATALOG,
          })
        : { database, functions: [], views: [], appFunctions: [] },
      limits: {
        maxStatementLength: MAX_LWQL_LENGTH,
        maxRowsReturned: DEFAULT_LWQL_RESULT_LIMITS.maxRows,
        maxResultBytes: DEFAULT_LWQL_RESULT_LIMITS.maxResultBytes,
        maxExecutionTimeSeconds:
          DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds,
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
    examples: describeExamples({ held, lwqlEnabled, database }),
    decisionTable: DECISION_TABLE,
  };
}

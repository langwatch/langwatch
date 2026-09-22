/**
 * One reference document for both of LangWatch's query languages: a question
 * belongs to the SQL or to the filter, and `GET /api/v1/query/reference` is the
 * door that says which. See ADR-154.
 * @see specs/analytics/query-reference.feature
 */
import { z } from "zod";

import { langWatchQLSchema } from "./analytics.lwql.ts";

/**
 * The document's shape version. Bumped when a consumer would have to change to
 * keep reading it, never when the content changes: a new example, a new field
 * and a new dataset all arrive under the same version.
 */
export const QUERY_REFERENCE_VERSION = "1";

/**
 * What kind of question an example answers, which drives the grouping. A closed
 * set rather than prose, because the REST boundary publishes it and an agent
 * choosing an example branches on it.
 */
export const QUERY_EXAMPLE_INTENTS = [
  "triage",
  "cost",
  "latency",
  "quality",
  "conversations",
  "discovery",
  "export",
] as const;

export const queryExampleIntentSchema = z.enum(QUERY_EXAMPLE_INTENTS);
export type QueryExampleIntent = z.infer<typeof queryExampleIntentSchema>;

/** Which language an example is written in. */
export const queryLanguageSchema = z.enum(["lwql", "trace-filter"]);
export type QueryLanguage = z.infer<typeof queryLanguageSchema>;

/** One HTTP door, so a reader never has to guess the path or the verb. */
export const queryReferenceEndpointSchema = z
  .object({
    method: z.enum(["GET", "POST"]),
    path: z.string(),
    description: z.string(),
  })
  .strict();
export type QueryReferenceEndpoint = z.infer<typeof queryReferenceEndpointSchema>;

/** One trace filter field, as the reference publishes it. */
export const queryReferenceFilterFieldSchema = z
  .object({
    /** The name a caller writes before the colon. */
    name: z.string(),
    label: z.string(),
    valueType: z.enum(["categorical", "range", "text", "existence"]),
    /** Where the field sits in the product's own grouping. */
    group: z.string().nullable(),
    /**
     * Whether the facets endpoint can list this field's values. False for a
     * free-text or existence field: there is no value set to list, and a caller
     * told otherwise spends a round trip finding that out.
     */
    facetable: z.boolean(),
    /**
     * The values this field is known to take, when they come from a closed set.
     * Static vocabulary only — never a value read from the project's traces, so
     * an empty list means "open set", not "no values".
     */
    knownValues: z.array(z.string()).readonly(),
  })
  .strict();
export type QueryReferenceFilterField = z.infer<typeof queryReferenceFilterFieldSchema>;

/** One open-ended attribute namespace. */
export const queryReferenceDynamicPrefixSchema = z
  .object({
    prefix: z.string(),
    label: z.string(),
    description: z.string(),
    /** Older spellings the translator still accepts for this namespace. */
    aliases: z.array(z.string()).readonly(),
  })
  .strict();
export type QueryReferenceDynamicPrefix = z.infer<typeof queryReferenceDynamicPrefixSchema>;

/** One bound parameter a published statement declares. */
export const queryReferenceParameterSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
  })
  .strict();
export type QueryReferenceParameter = z.infer<typeof queryReferenceParameterSchema>;

/** One worked query, in either language. */
export const queryReferenceExampleSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    intent: queryExampleIntentSchema,
    language: queryLanguageSchema,
    tags: z.array(z.string()).readonly(),
    /** The statement or filter string, exactly as it should be sent. */
    text: z.string(),
    parameters: z.array(queryReferenceParameterSchema).readonly(),
    requires: z
      .object({
        gates: z.array(z.string()).readonly(),
        /**
         * App-side LangWatchQL functions the statement calls. Empty until a
         * published example names one, so a consumer parses one shape either way.
         */
        functions: z.array(z.string()).readonly(),
      })
      .strict(),
    /** Whether this caller's permissions let them run it as written. */
    available: z.boolean(),
    notes: z.string().optional(),
  })
  .strict();
export type QueryReferenceExample = z.infer<typeof queryReferenceExampleSchema>;

/** One row of the "which language answers this" table. */
export const queryReferenceDecisionSchema = z
  .object({
    /** The kind of question, in the reader's words. */
    when: z.string(),
    /** What to reach for. */
    use: z.string(),
    /** Why that one and not the other. */
    why: z.string(),
  })
  .strict();
export type QueryReferenceDecision = z.infer<typeof queryReferenceDecisionSchema>;

/** What the LangWatchQL half publishes. */
export const queryReferenceLangWatchQLSchema = z
  .object({
    /**
     * Whether this caller can use the LangWatchQL half here — one flag for both
     * reasons it can be closed: the deployment serves no such surface, or the
     * credential does not hold the permission that opens it.
     */
    enabled: z.boolean(),
    /** Empty while `enabled` is false: a catalog nobody here can query. */
    schema: langWatchQLSchema,
    limits: z
      .object({
        maxStatementLength: z.number(),
        maxRowsReturned: z.number(),
        maxResultBytes: z.number(),
        maxExecutionTimeSeconds: z.number(),
        /** No pagination: the statement pages itself. See the keyset example. */
        pagination: z.string(),
      })
      .strict(),
    endpoints: z.array(queryReferenceEndpointSchema).readonly(),
  })
  .strict();
export type QueryReferenceLangWatchQL = z.infer<typeof queryReferenceLangWatchQLSchema>;

/** What the trace filter half publishes. */
export const queryReferenceTraceFilterSchema = z
  .object({
    /** The language's syntax, as markdown. */
    syntax: z.string(),
    fields: z.array(queryReferenceFilterFieldSchema).readonly(),
    dynamicPrefixes: z.array(queryReferenceDynamicPrefixSchema).readonly(),
    endpoints: z.array(queryReferenceEndpointSchema).readonly(),
  })
  .strict();
export type QueryReferenceTraceFilter = z.infer<typeof queryReferenceTraceFilterSchema>;

/** The whole document. */
export const queryReferenceSchema = z
  .object({
    version: z.string(),
    lwql: queryReferenceLangWatchQLSchema,
    traceFilter: queryReferenceTraceFilterSchema,
    examples: z.array(queryReferenceExampleSchema).readonly(),
    decisionTable: z.array(queryReferenceDecisionSchema).readonly(),
  })
  .strict();
export type QueryReference = z.infer<typeof queryReferenceSchema>;

/**
 * How far this credential reaches, resolved once by the door rather than by the
 * handler: whether it may run LangWatchQL at all decides which half of the
 * document is published, and the answer is the KEY's, never the request's.
 */
export const langWatchQLReachSchema = z.object({ canRunLangWatchQL: z.boolean() }).strict();
export type LangWatchQLReach = z.infer<typeof langWatchQLReachSchema>;

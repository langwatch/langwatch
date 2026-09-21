/**
 * The query family: the analytics SQL door and the reference that describes
 * both query languages.
 *
 * The reference is what replaced `schemas/filter-fields.ts`, a hand-copied list
 * of 24 filter field names that lived in this package and drifted: it named
 * fields the platform had renamed and missed the ones the Trace Explorer had
 * gained, and nothing could catch that because there was nothing to compare it
 * against. Fetching it means this server cannot describe a field the platform
 * does not have.
 *
 * @see specs/mcp-server/schema-discovery.feature
 */

import { makeRequest } from "./langwatch-api.js";

/** One column of a query result. */
export interface QueryResultColumn {
  name: string;
  type: string;
}

/** What `POST /api/v1/query` answers with. */
export interface QueryRunResponse {
  columns: QueryResultColumn[];
  rows: Record<string, unknown>[];
  statistics: {
    elapsedMs: number;
    rowsRead: number;
    bytesRead: number;
    rowsReturned: number;
  };
  truncated: boolean;
  diagnostics: { code: string; message: string }[];
}

/** One published dataset. */
export interface QueryReferenceView {
  name: string;
  description: string;
  grain: string;
  joinKeys: string[];
  timeColumn: string;
  freshness: string;
  columns: {
    name: string;
    type: string;
    description: string;
    unit: string | null;
    gates: string[];
    available: boolean;
  }[];
  exampleSql: string;
}

/** One worked query, in either language. */
export interface QueryReferenceExample {
  id: string;
  title: string;
  intent: string;
  language: "lwql" | "trace-filter";
  tags: string[];
  text: string;
  parameters: { name: string; type: string; description: string }[];
  requires: { gates: string[]; functions: string[] };
  available: boolean;
  notes?: string;
}

/** What `GET /api/v1/query/reference` answers with. */
export interface QueryReferenceResponse {
  version: string;
  lwql: {
    enabled: boolean;
    schema: { database: string; views: QueryReferenceView[] };
    limits: {
      maxStatementLength: number;
      maxRowsReturned: number;
      maxResultBytes: number;
      maxExecutionTimeSeconds: number;
      pagination: string;
    };
    endpoints: { method: string; path: string; description: string }[];
  };
  traceFilter: {
    syntax: string;
    fields: {
      name: string;
      label: string;
      valueType: string;
      group: string | null;
      facetable: boolean;
      knownValues: string[];
    }[];
    dynamicPrefixes: {
      prefix: string;
      label: string;
      description: string;
      aliases: string[];
    }[];
    endpoints: { method: string; path: string; description: string }[];
  };
  examples: QueryReferenceExample[];
  decisionTable: { when: string; use: string; why: string }[];
}

/** Runs one read-only LangWatchQL statement, as written. */
export async function runQuery(params: {
  sql: string;
  parameters?: Record<string, string | number | boolean | null>;
}): Promise<QueryRunResponse> {
  return makeRequest("POST", "/api/v1/query", {
    sql: params.sql,
    ...(params.parameters ? { parameters: params.parameters } : {}),
  }) as Promise<QueryRunResponse>;
}

/** Reads the query reference: both languages, their fields and worked examples. */
export async function getQueryReference(): Promise<QueryReferenceResponse> {
  return makeRequest("GET", "/api/v1/query/reference") as Promise<QueryReferenceResponse>;
}

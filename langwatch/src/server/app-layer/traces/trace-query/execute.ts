/**
 * Read-only executor for compiled trace queries (SPIKE #5670).
 *
 * Applies the per-query resource guardrails and emits a redacted audit record
 * (shape + sha256, literals stripped — reusing `redactQueryForAudit` so the
 * audit log never becomes a PII sink, SR-8/SR-9). The read-only guarantee has
 * TWO independent layers, matching SR-2:
 *   1. by construction — the compiler cannot emit a write verb, and
 *   2. by execution — `readonly=2` blocks writes at the CH protocol for a
 *      normal user; in production this becomes the server-side `readonly_safe`
 *      profile of the SELECT-only `langwatch_ops` user (pass
 *      `enforceReadonly:false` then, since that user forbids changing settings).
 *
 * NOT SOLVED HERE (production gaps, see the research doc SR-6): per-user query
 * concurrency cap and per-tenant rate limiting, and a dedicated read-only
 * replica so ad-hoc load can't contend with the product read path.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { redactQueryForAudit } from "~/server/ops/explain-core";
import { createLogger } from "~/utils/logger/server";
import type { CompiledQuery } from "./compile";

const logger = createLogger("langwatch:trace-query:execute");

/** Per-query caps. Settable client-side under readonly=2. */
const EXEC_CAPS = {
  max_execution_time: 10,
  max_result_bytes: "10000000",
  max_memory_usage: "1073741824",
  // A quantile over an all-NULL group returns NaN; with denormals unquoted
  // ClickHouse writes a bare `nan` token that is invalid JSON and throws in
  // result.json(). Quote denormals so such a row parses to a string instead.
  output_format_json_quote_denormals: 1,
} as const;

export interface ExecuteArgs {
  compiled: CompiledQuery;
  /** The read-only ClickHouse client to run on (injected — testable). */
  client: ClickHouseClient;
  /** Audit dimension: whose data is being read. */
  tenantId: string;
  /** Audit dimension: who is asking. */
  caller?: string;
  /**
   * Send `readonly=2` client-side (default). Set false when the client already
   * authenticates as a server-side read-only user (e.g. langwatch_ops), which
   * forbids changing the readonly setting.
   */
  enforceReadonly?: boolean;
}

export interface QueryResult {
  rows: Array<Record<string, unknown>>;
  audit: { shape: string; sha256: string };
}

export async function executeTraceQuery({
  compiled,
  client,
  tenantId,
  caller,
  enforceReadonly = true,
}: ExecuteArgs): Promise<QueryResult> {
  const audit = redactQueryForAudit(compiled.sql);

  const settings = enforceReadonly
    ? { ...EXEC_CAPS, readonly: "2" as const }
    : EXEC_CAPS;

  const started = performance.now();
  try {
    const result = await client.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: "JSONEachRow",
      clickhouse_settings: settings,
    });
    const rows = await result.json<Record<string, unknown>>();
    logger.info(
      {
        tenantId,
        caller,
        shape: audit.shape,
        sha256: audit.sha256,
        rowCount: rows.length,
        elapsedMs: Math.round(performance.now() - started),
        outcome: "ok",
      },
      "trace-query executed",
    );
    return { rows, audit };
  } catch (error) {
    logger.warn(
      {
        tenantId,
        caller,
        shape: audit.shape,
        sha256: audit.sha256,
        elapsedMs: Math.round(performance.now() - started),
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      },
      "trace-query failed",
    );
    throw error;
  }
}

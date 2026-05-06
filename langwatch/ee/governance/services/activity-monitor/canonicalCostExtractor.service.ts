// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Canonical cost-event extractor.
 *
 * Reads cost-bearing events from an OTLP logs request using ONLY the
 * `langwatch.*` namespace. After the aigateway runs the source's
 * `parserConfig.ottlStatements` over the request, every supported
 * upstream tool (Claude Code, Codex, Gemini, Copilot Studio, ...)
 * surfaces its per-request signals in the same canonical fields, so
 * the receiver doesn't need a per-tool branch.
 *
 * Field contract (locked with @sergey_2):
 *   - langwatch.cost.usd            (double | string-of-double)
 *   - langwatch.request_id          (string, idempotency key)
 *   - langwatch.model               (string)
 *   - langwatch.input_tokens        (int)
 *   - langwatch.output_tokens       (int)
 *   - langwatch.cache_read_tokens   (int)
 *   - langwatch.cache_creation_tokens (int)
 *   - langwatch.principal.email     (string, optional)
 *   - langwatch.team.id_hint        (string, optional)
 *
 * Resource attributes are merged into the per-record bag the same way
 * the legacy claude_code extractor does — so OTTL statements that
 * target `resource.attributes["..."]` flow through transparently.
 *
 * Spec: specs/ai-governance/ingestion-sources/claude-code-otlp.feature
 */
import type {
  IExportLogsServiceRequest,
  IKeyValue,
  ILogRecord,
} from "@opentelemetry/otlp-transformer";

export interface CanonicalCostEvent {
  costUsd: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requestId: string;
  occurredAt: Date;
  /** OAuth/SSO-resolved user email if the OTTL statements promoted it. */
  userEmail: string | null;
  /** Resource-attr-supplied team identifier hint (slug-or-id, resolved
   *  to a Team row by the receiver before applying budget scopes). */
  teamIdHint: string | null;
  /** Free-form passthrough of any other resource/log attrs the caller
   *  may want for audit/debug. Excludes the canonical fields above. */
  raw: Record<string, unknown>;
}

const F = {
  COST_USD: "langwatch.cost.usd",
  REQUEST_ID: "langwatch.request_id",
  MODEL: "langwatch.model",
  INPUT_TOKENS: "langwatch.input_tokens",
  OUTPUT_TOKENS: "langwatch.output_tokens",
  CACHE_READ_TOKENS: "langwatch.cache_read_tokens",
  CACHE_CREATION_TOKENS: "langwatch.cache_creation_tokens",
  PRINCIPAL_EMAIL: "langwatch.principal.email",
  TEAM_ID_HINT: "langwatch.team.id_hint",
} as const;

export function extractCanonicalCostEvents(
  request: IExportLogsServiceRequest,
): CanonicalCostEvent[] {
  const out: CanonicalCostEvent[] = [];
  for (const rl of request.resourceLogs ?? []) {
    const resourceAttrs = mergeAttributes(rl.resource?.attributes ?? []);
    for (const sl of rl.scopeLogs ?? []) {
      for (const record of sl.logRecords ?? []) {
        const event = tryParseEvent(record, resourceAttrs);
        if (event) out.push(event);
      }
    }
  }
  return out;
}

function mergeAttributes(kvs: IKeyValue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kv of kvs) {
    if (!kv.key) continue;
    const v = kv.value as
      | { stringValue?: string }
      | { intValue?: string | number }
      | { doubleValue?: number }
      | { boolValue?: boolean }
      | undefined;
    if (!v) continue;
    if ("stringValue" in v && v.stringValue !== undefined) {
      out[kv.key] = v.stringValue;
    } else if ("intValue" in v && v.intValue !== undefined) {
      out[kv.key] =
        typeof v.intValue === "string" ? Number(v.intValue) : v.intValue;
    } else if ("doubleValue" in v && v.doubleValue !== undefined) {
      out[kv.key] = v.doubleValue;
    } else if ("boolValue" in v && v.boolValue !== undefined) {
      out[kv.key] = v.boolValue;
    }
  }
  return out;
}

function tryParseEvent(
  record: ILogRecord,
  resourceAttrs: Record<string, unknown>,
): CanonicalCostEvent | null {
  const recordAttrs = mergeAttributes(record.attributes ?? []);
  const merged = { ...resourceAttrs, ...recordAttrs };
  const requestId = stringOrNull(merged[F.REQUEST_ID]);
  const costUsd = numberOrNull(merged[F.COST_USD]);
  if (!requestId || costUsd === null) {
    // Without these two, the row can't be inserted idempotently or
    // costed. The receiver still hands the LogRecord to the trace
    // pipeline for forensic /me Recent Activity surfaces.
    return null;
  }
  return {
    costUsd,
    model: stringOrNull(merged[F.MODEL]) ?? "unknown",
    inputTokens: numberOr(merged[F.INPUT_TOKENS], 0),
    outputTokens: numberOr(merged[F.OUTPUT_TOKENS], 0),
    cacheReadTokens: numberOr(merged[F.CACHE_READ_TOKENS], 0),
    cacheCreationTokens: numberOr(merged[F.CACHE_CREATION_TOKENS], 0),
    requestId,
    occurredAt: recordToDate(record),
    userEmail: stringOrNull(merged[F.PRINCIPAL_EMAIL]),
    teamIdHint: stringOrNull(merged[F.TEAM_ID_HINT]),
    raw: merged,
  };
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function recordToDate(record: ILogRecord): Date {
  const t = record.timeUnixNano as string | number | undefined;
  if (t === undefined) return new Date();
  const nanos = typeof t === "string" ? BigInt(t) : BigInt(Math.floor(t));
  return new Date(Number(nanos / 1_000_000n));
}

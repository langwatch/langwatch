// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @deprecated Superseded by the canonical OTTL extraction path
 * (`canonicalCostExtractor.service.ts` + the aigateway's
 * `/internal/transform` endpoint). Sources created with
 * `parserConfig.ottlStatements` populated route through the canonical
 * path; this hardcoded reader stays only as the fall-back for legacy
 * sources that were created before OTTL shipped.
 *
 * Removal target: once every IngestionSource row in production has
 * `parserConfig.ottlStatements` set (either by manual admin migration
 * or by a backfill that injects the canonical 9-statement starter for
 * source_type='claude_code'), this file can be deleted along with the
 * receiver-side fallback in `ingestionRoutes.ts`.
 *
 * --- original header below ---
 *
 * Claude Code OTLP event-to-ledger extractor.
 *
 * Claude Code emits two OTLP signals on a successful API call:
 *
 *   1. `claude_code.cost.usage` — Sum metric, monotonic, USD unit,
 *      DELTA temporality. Cumulative since process start; deltas
 *      between data points are the per-request spend.
 *
 *   2. `claude_code.api_request` — LogRecord with `body.stringValue =
 *      "claude_code.api_request"` plus per-request attributes:
 *        - `cost_usd` (doubleValue)        — direct USD spend
 *        - `input_tokens` / `output_tokens` (intValue)
 *        - `cache_read_tokens` / `cache_creation_tokens` (intValue)
 *        - `model` (string, e.g. "claude-opus-4-7")
 *        - `request_id` (Anthropic API req-id, idempotency key)
 *        - `prompt.id` / `session.id` / `event.sequence`
 *        - `user.email` (when OAuth-authed) — principal attribution
 *
 * For v0 budget ledger writes we use the EVENT path (one log record =
 * one ledger row, idempotent on `request_id`). The metric counter is
 * skipped — it would require delta math against state that doesn't
 * survive worker restarts. Counter synthesis can land in v2 if a
 * customer emits metrics-only.
 *
 * Resource attributes (`team.id`, `cost_center`, `organization.id`)
 * live on the OTLP resource, not on the LogRecord — the merge happens
 * here so callers see a flat key/value bag per event.
 *
 * Spec: docs/ai-governance/ingestion-sources/claude-code-otlp.feature
 *       (Lane-B BDD scaffold post-payload-capture).
 *
 * Captured payload reference:
 *   Ariana QA dogfood 2026-05-06 — Claude Code 2.1.129, OAuth-billed.
 */
import type {
  IExportLogsServiceRequest,
  IKeyValue,
  ILogRecord,
} from "@opentelemetry/otlp-transformer";

/**
 * One Claude Code API request, cost-bearing. Shape is denormalised:
 * resource attrs are merged into log-record attrs so callers don't
 * have to walk the OTLP envelope themselves.
 */
export interface ClaudeCodeCostEvent {
  costUsd: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requestId: string;
  promptId: string | null;
  sessionId: string | null;
  /** ISO 8601 UTC string from the LogRecord's timeUnixNano. */
  occurredAt: Date;
  /** OAuth-authed user email; null for anonymous Claude Code installs. */
  userEmail: string | null;
  /** Anthropic-side org UUID; orthogonal to LangWatch organizationId. */
  anthropicOrganizationId: string | null;
  /** Optional resource-attr-supplied team identifier
   * (`OTEL_RESOURCE_ATTRIBUTES=team.id=…`). NOT a LangWatch teamId — the
   * ingestion source's resolver maps this to a Team row by slug if
   * present, else falls back to source.teamId. */
  teamIdHint: string | null;
  /** Free-form passthrough of any other resource/log attrs the caller
   * may want for audit/debug. Excludes the typed fields above. */
  raw: Record<string, unknown>;
}

const EVENT_NAME_BODY = "claude_code.api_request";
const EVENT_NAME_ATTR = "api_request";

let deprecationWarnedOnce = false;

export function extractClaudeCodeCostEvents(
  request: IExportLogsServiceRequest,
): ClaudeCodeCostEvent[] {
  if (!deprecationWarnedOnce) {
    deprecationWarnedOnce = true;
    // One-shot per-process warning — this code path stays for sources
    // created before OTTL shipped, but every NEW source carries a
    // starter template so live traffic should drain off this reader.
    console.warn(
      "[deprecated] claudeCodeIngestionExtractor invoked — source has no parserConfig.ottlStatements; reading via legacy hardcoded extractor. Migrate by editing the source and saving the canonical starter template.",
    );
  }
  const out: ClaudeCodeCostEvent[] = [];
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

/**
 * Best-effort merge: returns a flat bag from OTLP `KeyValue[]`. Falls
 * through unknown anyValue shapes by stringifying — caller can pull
 * typed views (number, string) on the way out.
 */
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
      // OTLP transports intValue as string in JSON to avoid JS number
      // precision loss for large ints; coerce to number for our use
      // (token counts are well under 2^53).
      out[kv.key] = typeof v.intValue === "string" ? Number(v.intValue) : v.intValue;
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
): ClaudeCodeCostEvent | null {
  // Identify the cost-bearing event two ways: body.stringValue OR
  // attribute event.name. Claude Code emits both interchangeably
  // depending on SDK version — accept either.
  const bodyValue =
    record.body && "stringValue" in record.body
      ? record.body.stringValue
      : undefined;
  const recordAttrs = mergeAttributes(record.attributes ?? []);
  const eventName = recordAttrs["event.name"];
  const matches =
    bodyValue === EVENT_NAME_BODY ||
    eventName === EVENT_NAME_ATTR ||
    eventName === EVENT_NAME_BODY;
  if (!matches) return null;

  const merged = { ...resourceAttrs, ...recordAttrs };
  const requestId = stringOrNull(merged["request_id"]);
  const costUsdRaw = merged["cost_usd"];
  const costUsd = typeof costUsdRaw === "number" ? costUsdRaw : null;
  if (!requestId || costUsd === null) {
    // Without these two, the row can't be inserted idempotently or
    // costed; quietly drop. (The receiver still records the LogRecord
    // for the forensic /me Recent Activity surface separately.)
    return null;
  }
  const occurredAt = recordToDate(record);
  return {
    costUsd,
    model: stringOrNull(merged["model"]) ?? "unknown",
    inputTokens: numberOr(merged["input_tokens"], 0),
    outputTokens: numberOr(merged["output_tokens"], 0),
    cacheReadTokens: numberOr(merged["cache_read_tokens"], 0),
    cacheCreationTokens: numberOr(merged["cache_creation_tokens"], 0),
    requestId,
    promptId: stringOrNull(merged["prompt.id"]),
    sessionId: stringOrNull(merged["session.id"]),
    occurredAt,
    userEmail: stringOrNull(merged["user.email"]),
    anthropicOrganizationId: stringOrNull(merged["organization.id"]),
    teamIdHint: stringOrNull(merged["team.id"]),
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

function recordToDate(record: ILogRecord): Date {
  // OTLP timeUnixNano is a string in JSON (BigInt-shaped). Date
  // accepts ms, so divide by 1_000_000 with the same string-or-number
  // coercion the attribute parser uses.
  const t = record.timeUnixNano as string | number | undefined;
  if (t === undefined) return new Date();
  const nanos = typeof t === "string" ? BigInt(t) : BigInt(Math.floor(t));
  return new Date(Number(nanos / 1_000_000n));
}

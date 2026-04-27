/**
 * OTel passthrough normaliser — minimal MVP for the otel_generic +
 * claude_cowork SourceType receivers.
 *
 * Scope: take a canonical OTLP traces export request (shared parser
 * output, see src/server/otel/parseOtlpBody.ts) and emit one
 * ActivityEventRow per span. Per-platform attribute extraction
 * (Cowork's tool_use spans, Workato's recipe events) lives in
 * platform-specific normalisers that ship in follow-up adapter slices.
 *
 * This module deliberately does NOT parse the wire body — that's
 * shared between /api/otel/v1/traces and /api/ingest/otel/:sourceId
 * via the canonical OTLP-transformer parser. We consume the parsed
 * IExportTraceServiceRequest directly. Master directive 2026-04-27:
 * shared core for OTLP body parse, separate downstream pipelines.
 *
 * Spec: docs/ai-gateway/governance/architecture.md (OCSF + AOS schema)
 */
import { randomUUID } from "crypto";

import type { IngestionSource } from "@prisma/client";
import type {
  IExportTraceServiceRequest,
  IKeyValue,
  ISpan,
} from "@opentelemetry/otlp-transformer";

import type { ActivityEventRow } from "../activityEvent.repository";

/**
 * Map a parsed OTLP traces export request to a flat list of OCSF
 * ActivityEventRows. Empty / spanless requests return [] — receivers
 * still 202-ack so upstream platforms don't retry-bomb us.
 */
export function normalizeOtlpRequest(
  source: IngestionSource,
  request: IExportTraceServiceRequest,
  rawPayload: string,
): ActivityEventRow[] {
  const events: ActivityEventRow[] = [];
  for (const rs of request.resourceSpans ?? []) {
    const resourceAttrs = attrsToMap(rs.resource?.attributes);
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        events.push(spanToActivityEvent(source, span, resourceAttrs, rawPayload));
      }
    }
  }
  return events;
}

function spanToActivityEvent(
  source: IngestionSource,
  span: ISpan,
  resourceAttrs: Record<string, string>,
  rawPayload: string,
): ActivityEventRow {
  const spanAttrs = attrsToMap(span.attributes);
  const all = { ...resourceAttrs, ...spanAttrs };
  return {
    tenantId: source.id,
    organizationId: source.organizationId,
    sourceType: source.sourceType,
    sourceId: source.id,
    eventId: bytesToHex(span.spanId) || bytesToHex(span.traceId) || randomUUID(),
    eventType: deriveEventType(span.name, all),
    actor: pickActor(all),
    action: span.name ?? "",
    target: pickTarget(all),
    costUsd: pickCost(all),
    tokensInput: pickTokens(all, "input"),
    tokensOutput: pickTokens(all, "output"),
    rawPayload,
    eventTimestamp: parseSpanStart(span.startTimeUnixNano),
  };
}

/**
 * IKeyValue.value can carry stringValue / intValue / doubleValue /
 * boolValue / arrayValue / kvlistValue / bytesValue. We flatten to a
 * string for the OCSF mapping; non-scalar shapes (arrays/kvlists) are
 * skipped today. intValue from protobuf-decoded payloads can arrive
 * as Long.js / number / string depending on encoding — coerce via
 * String() rather than typeof checks so all three work.
 */
function attrsToMap(
  attrs: IKeyValue[] | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!attrs) return map;
  for (const attr of attrs) {
    const v = attr.value;
    if (!v) continue;
    if (typeof v.stringValue === "string") {
      map[attr.key] = v.stringValue;
      continue;
    }
    if (v.intValue !== null && v.intValue !== undefined) {
      map[attr.key] = String(v.intValue);
      continue;
    }
    if (typeof v.doubleValue === "number") {
      map[attr.key] = String(v.doubleValue);
      continue;
    }
    if (typeof v.boolValue === "boolean") {
      map[attr.key] = String(v.boolValue);
      continue;
    }
  }
  return map;
}

function deriveEventType(
  spanName: string | undefined,
  attrs: Record<string, string>,
): string {
  // Heuristics for the OCSF taxonomy. Platform-specific normalisers
  // refine this later — this is the catch-all default.
  if (attrs["llm.request.type"] === "completion" || /chat|messages/i.test(spanName ?? "")) {
    return "api.call";
  }
  if (attrs["tool.name"] || /tool|function/i.test(spanName ?? "")) {
    return "tool.invocation";
  }
  if (/auth|signin|signout|login/i.test(spanName ?? "")) {
    return "auth.action";
  }
  return "agent.action";
}

function pickActor(attrs: Record<string, string>): string {
  return (
    attrs["langwatch.user.id"] ??
    attrs["user.email"] ??
    attrs["user.id"] ??
    attrs["enduser.id"] ??
    ""
  );
}

function pickTarget(attrs: Record<string, string>): string {
  return (
    attrs["llm.model"] ??
    attrs["gen_ai.request.model"] ??
    attrs["model"] ??
    attrs["tool.name"] ??
    ""
  );
}

function pickCost(attrs: Record<string, string>): string | undefined {
  const raw =
    attrs["llm.cost.usd"] ??
    attrs["gen_ai.usage.cost"] ??
    attrs["gen_ai.usage.cost_usd"] ??
    attrs["langwatch.cost.usd"];
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return n.toFixed(6);
}

function pickTokens(
  attrs: Record<string, string>,
  kind: "input" | "output",
): number {
  const candidates =
    kind === "input"
      ? [
          "llm.token_count.prompt",
          "gen_ai.usage.prompt_tokens",
          "gen_ai.usage.input_tokens",
          "input_tokens",
        ]
      : [
          "llm.token_count.completion",
          "gen_ai.usage.completion_tokens",
          "gen_ai.usage.output_tokens",
          "output_tokens",
        ];
  for (const k of candidates) {
    const raw = attrs[k];
    if (raw === undefined) continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * span.startTimeUnixNano arrives as Long | string | number depending
 * on whether the body came via protobuf (Long) or JSON (string).
 * Coerce to BigInt via String() then divide for ms.
 */
function parseSpanStart(
  startTimeUnixNano: ISpan["startTimeUnixNano"] | undefined,
): Date {
  if (startTimeUnixNano === undefined || startTimeUnixNano === null) {
    return new Date();
  }
  try {
    const ns = BigInt(String(startTimeUnixNano));
    if (ns === 0n) return new Date();
    const ms = Number(ns / 1_000_000n);
    return new Date(ms);
  } catch {
    return new Date();
  }
}

/**
 * span.spanId / traceId arrive as Uint8Array on protobuf-decoded
 * bodies, or as a hex string on JSON bodies. Render to a stable hex
 * string for the eventId.
 */
function bytesToHex(value: ISpan["spanId"] | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  return "";
}

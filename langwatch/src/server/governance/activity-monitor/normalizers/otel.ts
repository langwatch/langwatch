/**
 * OTel passthrough normaliser — minimal MVP for the otel_generic +
 * claude_cowork SourceType receivers.
 *
 * Scope: parse an OTLP/HTTP body (JSON-encoded resource_spans), emit
 * one ActivityEventRow per span. Per-platform attribute extraction
 * (Cowork's tool_use spans, Workato's recipe events) lives in
 * platform-specific normalisers that ship in follow-up adapter slices.
 *
 * Spec: docs/ai-gateway/governance/architecture.md (OCSF + AOS schema)
 */
import { randomUUID } from "crypto";

import type { IngestionSource } from "@prisma/client";

import type { ActivityEventRow } from "../activityEvent.repository";

interface OtlpAttribute {
  key: string;
  value?: { stringValue?: string; intValue?: number; doubleValue?: number };
}

interface OtlpSpan {
  spanId?: string;
  traceId?: string;
  name?: string;
  startTimeUnixNano?: string;
  attributes?: OtlpAttribute[];
}

interface OtlpScopeSpans {
  spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
  resource?: { attributes?: OtlpAttribute[] };
  scope_spans?: OtlpScopeSpans[];
  scopeSpans?: OtlpScopeSpans[];
}

interface OtlpBody {
  resource_spans?: OtlpResourceSpans[];
  resourceSpans?: OtlpResourceSpans[];
}

/**
 * Parse a JSON OTLP body and emit one normalised event per span.
 * Empty / malformed payloads return an empty array — receivers still
 * 202-ack so upstream platforms don't retry-bomb us.
 */
export function normalizeOtlpJson(
  source: IngestionSource,
  rawBody: string,
): ActivityEventRow[] {
  let parsed: OtlpBody;
  try {
    parsed = JSON.parse(rawBody) as OtlpBody;
  } catch {
    return [];
  }

  const resourceSpans = parsed.resource_spans ?? parsed.resourceSpans ?? [];
  const events: ActivityEventRow[] = [];

  for (const rs of resourceSpans) {
    const resourceAttrs = attrsToMap(rs.resource?.attributes);
    const scopeSpans = rs.scope_spans ?? rs.scopeSpans ?? [];
    for (const ss of scopeSpans) {
      const spans = ss.spans ?? [];
      for (const span of spans) {
        events.push(spanToActivityEvent(source, span, resourceAttrs, rawBody));
      }
    }
  }

  return events;
}

function spanToActivityEvent(
  source: IngestionSource,
  span: OtlpSpan,
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
    eventId: span.spanId ?? span.traceId ?? randomUUID(),
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

function attrsToMap(
  attrs: OtlpAttribute[] | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!attrs) return map;
  for (const attr of attrs) {
    if (typeof attr.value?.stringValue === "string") {
      map[attr.key] = attr.value.stringValue;
    } else if (typeof attr.value?.intValue === "number") {
      map[attr.key] = String(attr.value.intValue);
    } else if (typeof attr.value?.doubleValue === "number") {
      map[attr.key] = String(attr.value.doubleValue);
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

function parseSpanStart(startTimeUnixNano: string | undefined): Date {
  if (!startTimeUnixNano) return new Date();
  const ns = BigInt(startTimeUnixNano);
  const ms = Number(ns / 1_000_000n);
  return new Date(ms);
}

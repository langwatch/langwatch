// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What every pulled conversation shares, regardless of which product it came
 * from: how its identifiers are derived, how its origin is stamped, and how
 * its spans are wrapped for export.
 *
 * This exists because a second conversation-bearing source arrived. The Genie
 * mapper was the only one for a while and grew the shape of its provider into
 * everything it touched — Databricks field names, Databricks status values,
 * Databricks timestamp units. Copying it for the next source would have
 * copied four properties nobody would notice were gone until a customer's
 * conversations went missing:
 *
 *   1. Identifiers are namespaced by ingestion source. Two sources are two
 *      independent identifier domains; an unqualified seed gambles on their
 *      values never colliding, and every way that bet loses is silent —
 *      matching span ids drop the second conversation, matching thread ids
 *      interleave two products' turns into one rendered conversation.
 *   2. Identifiers are derived, never invented. The same conversation pulled
 *      twice must land on the same identifier or it duplicates.
 *   3. The agent name may only come from a closed set, because cost
 *      enrichment runs on any `llm` span and a name that resolves in the
 *      pricing table puts a price on a conversation nobody was charged for.
 *   4. Origin attributes match the push-mode receiver's exactly, so routed
 *      traces filter like pushed ones.
 *
 * What deliberately is NOT here: which fields name a conversation, how to
 * read a timestamp, what counts as finished, and what to do when a timestamp
 * cannot be read. Those differ per source in ways that matter — Genie falls
 * back to pull time when it cannot date a message, Copilot must drop the turn
 * instead, and moving that decision here would silently give one source the
 * other's behaviour.
 */

import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { createHash } from "crypto";
import type { z } from "zod";
import type { spanSchema } from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";
import { PROVENANCE_ATTR_SOURCE } from "../ingestKeyProvenance.utils";

/**
 * Every agent a routing profile is allowed to name.
 *
 * Cost enrichment runs unconditionally on `llm` spans, and a routed
 * conversation stays cost-free only because its agent name resolves to no
 * price row. That held for free while the name was one constant nobody
 * outside the Genie mapper could reach. Now that a profile carries it, a
 * free-form string would hand the property away — a source naming a real
 * model would put a real price on a conversation nobody was charged for.
 * Keeping the set closed moves the question to review time: adding a name
 * here is the moment to check it cannot match a price.
 */
export const KNOWN_AGENT_IDENTITIES = [
  "databricks/genie",
  "microsoft/copilot-studio",
] as const;

export type KnownAgentIdentity = (typeof KNOWN_AGENT_IDENTITIES)[number];

/**
 * What one source contributes to the shape of a routed conversation.
 *
 * These travelled as Databricks constants while Genie was the only source
 * that routed. They travel with the source now so a second source's
 * conversations are not filed under a product the customer does not have —
 * and, in the case of `conversationAction`, so that one source's events can
 * never be rendered as another's.
 */
export interface ConversationRoutingProfile {
  /** The puller action that marks an event as a conversation to route. */
  conversationAction: string;
  /** Product label for the agent that answered. Never a priced model. */
  agentModel: KnownAgentIdentity;
  /** Value of `langwatch.source` — where this conversation came from. */
  provenanceSource: string;
  /** OTLP scope name for the batch this source produces. */
  scopeName: string;
  /**
   * Prefix that separates this source's identifier domain from every other
   * source's. It lives here rather than in a mapper so that no mapper can
   * quietly reseed its own identity — see `deriveConversationIdentity`.
   */
  identityNamespace: string;
}

/**
 * The context stamped as receiver-authoritative origin. Matches the push-mode
 * receiver's `stampOriginAttrs` keys so the governance fold and OCSF
 * projections filter routed traces exactly like pushed ones.
 */
export interface RoutingOrigin {
  ingestionSourceId: string;
  organizationId: string;
  sourceType: string;
  /** What this source contributes to the conversations it routes. */
  profile: ConversationRoutingProfile;
}

export type OtlpJsonAttr = {
  key: string;
  value: { stringValue?: string; intValue?: number };
};

/**
 * Named rather than positional because both halves are strings. Given two
 * positional arguments, a transposed call compiles and emits a
 * plausible-looking attribute with its key and value the wrong way round —
 * which no assertion catches unless it happens to pin that exact attribute,
 * and the Genie suite pins two of its seven.
 */
export function stringAttr(params: {
  key: string;
  value: string;
}): OtlpJsonAttr {
  return { key: params.key, value: { stringValue: params.value } };
}

export function intAttr(params: { key: string; value: number }): OtlpJsonAttr {
  return { key: params.key, value: { intValue: params.value } };
}

export function originAttrs(origin: RoutingOrigin): OtlpJsonAttr[] {
  return [
    stringAttr({ key: "langwatch.origin.kind", value: "ingestion_source" }),
    stringAttr({
      key: "langwatch.ingestion_source.id",
      value: origin.ingestionSourceId,
    }),
    stringAttr({
      key: "langwatch.ingestion_source.organization_id",
      value: origin.organizationId,
    }),
    stringAttr({
      key: "langwatch.ingestion_source.source_type",
      value: origin.sourceType,
    }),
    stringAttr({
      key: PROVENANCE_ATTR_SOURCE,
      value: origin.profile.provenanceSource,
    }),
  ];
}

/** 16-byte trace id / 8-byte span id, hex, derived from stable coordinates. */
export function hashId(material: string, hexLength: 32 | 16): string {
  return createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, hexLength);
}

export function msToNano(ms: number): string {
  return `${Math.round(ms)}000000`;
}

/**
 * A field a source considers part of an identifier. Numbers are allowed
 * because at least one source counts attempts; they are stringified on the
 * way in so a numeric 0 and the string "0" cannot seed differently.
 */
export type IdentityField = string | number;

/**
 * The seeding contract between the shared assembly and a source's mapper.
 *
 * The mapper decides WHICH of its fields name a trace, a thread, and a span —
 * those differ genuinely between products, and pretending otherwise would
 * force one source's shape onto another. Genie names a trace by conversation
 * and message, because a Genie trace is one question and its answer. A source
 * whose trace is a whole conversation names it by conversation alone.
 *
 * The assembly decides HOW those fields become identifiers: namespaced by
 * source, joined in the order given, hashed. A mapper that built its own
 * identifiers could drop the namespace — which is the failure this split is
 * meant to make impossible rather than merely discouraged.
 */
export interface ConversationSeeds {
  /** Ordered fields naming the trace. */
  trace: IdentityField[];
  /** Ordered fields naming the thread — the explorer's grouping key. */
  thread: IdentityField[];
  /** Ordered fields naming one span attempt. */
  span: IdentityField[];
}

export interface ConversationIdentity {
  traceId: string;
  /** `thread` fields namespaced by source; the explorer groups on this. */
  threadId: string;
  /** Material for span ids beneath the root; suffix it per span. */
  spanSeed: string;
  rootSpanId: string;
}

export function deriveConversationIdentity(
  origin: RoutingOrigin,
  seeds: ConversationSeeds,
): ConversationIdentity {
  const namespace = `${origin.profile.identityNamespace}:${origin.ingestionSourceId}`;
  const join = (fields: IdentityField[]) => fields.map(String).join(":");
  const spanSeed = `${namespace}:${join(seeds.span)}`;
  return {
    traceId: hashId(`${namespace}:${join(seeds.trace)}`, 32),
    threadId: `${origin.ingestionSourceId}:${join(seeds.thread)}`,
    spanSeed,
    rootSpanId: hashId(`${spanSeed}:root`, 16),
  };
}

/**
 * One span as the mappers build it, taken from the schema that validates it
 * downstream (`spanSchema`, schemas/otlp.ts) rather than from the transformer
 * interface — that one demands protobuf-flavoured fields (`Uint8Array` ids)
 * the JSON path never uses.
 *
 * `z.input`, not `z.infer`: several of the schema's fields carry `.default()`,
 * so the parsed OUTPUT has `events`, `links`, `status` and the `dropped*`
 * counts as required. A mapper writes the input side, where those are the
 * optional fields they actually are.
 */
export type OtlpJsonSpan = z.input<typeof spanSchema>;

/**
 * Wrap a source's spans for export. Returns null when nothing routed, which
 * every caller treats as "this run produced no conversations" rather than an
 * error — a pull with no conversations in it is the normal case.
 */
export function assembleTraceRequest(
  spans: OtlpJsonSpan[],
  profile: ConversationRoutingProfile,
): IExportTraceServiceRequest | null {
  if (spans.length === 0) return null;
  return {
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [{ scope: { name: profile.scopeName }, spans }],
      },
    ],
  } as IExportTraceServiceRequest;
}

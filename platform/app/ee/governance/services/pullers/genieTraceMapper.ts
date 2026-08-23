// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Databricks Genie conversation → OTLP trace request (ADR-088 v7).
 *
 * Turns the puller's normalized `genie_query` events into the same
 * `IExportTraceServiceRequest` shape the OTLP receiver hands to
 * `handleOtlpTraceRequest`, so validation, dedup, journaling, redaction, and
 * token estimation all come from the standard trace door — no parallel
 * pipeline.
 *
 * Identity (Decision 10): trace id = hash(conversation_id + message_id),
 * span ids = the same plus `auto_regenerate_count`. The event store is
 * first-write-wins per span id, so an unchanged re-pull is a durable no-op
 * and a REGENERATED answer (bumped count) lands as a new attempt entry
 * beside the original instead of being silently dropped.
 *
 * Rendering contract (Decision 12, from the 35-message capture):
 *   user bubble      ← message.content            (langwatch.input)
 *   assistant bubble ← the ANSWER text attachment (langwatch.output)
 *   thinking block   ← query thoughts flattened UNDERSTANDING →
 *                      DATA_SOURCING → STEPS into `reasoning_content`
 *                      (the field the transcript parser already reads);
 *                      DESCRIPTION dropped — byte-identical to
 *                      query.description, which labels the step row instead
 *   step rows        ← one child span per query attachment
 *   viz              ← pointer attribute only, nothing rendered
 *   suggested_questions ← dropped explicitly: Genie's offered follow-ups,
 *                      never something a person said
 *
 * The mapping is defensive (Decision 13): an unknown status or missing
 * attachments still renders the user's question with a failure marker,
 * never a false success.
 */

import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { createHash } from "crypto";
import { PROVENANCE_ATTR_SOURCE } from "../ingestKeyProvenance.utils";
import type { NormalizedPullEvent } from "./pullerAdapter";

/** Root span (the turn itself, `llm`-typed so the estimator runs). */
export const GENIE_MESSAGE_SPAN_NAME = "databricks_genie.message" as const;
/** One per generated-query attachment; listed by the TurnSteps strip. */
export const GENIE_QUERY_SPAN_NAME = "databricks_genie.query" as const;
/** Provenance value under `langwatch.source` (Decision 8). */
export const GENIE_PROVENANCE_SOURCE = "databricks_genie" as const;
/**
 * Agent identity on the answer span. Deliberately a product label, not a
 * priced model: Decision 14(d) pins that it never resolves in the pricing
 * table, so cost enrichment stays empty by rule.
 */
export const GENIE_AGENT_MODEL = "databricks/genie" as const;

/** The puller action this mapper understands. Aggregate pulls never route. */
export const GENIE_QUERY_ACTION = "genie_query" as const;

/**
 * The wire shape (verified against the 35-message capture,
 * 30_genie_messages.raw.jsonl) keys thoughts by `thought_type` with
 * enum-prefixed values ("THOUGHT_TYPE_UNDERSTANDING"); `type`/bare values
 * are tolerated in case the API ever drops the prefix.
 */
interface GenieThought {
  thought_type?: string;
  type?: string;
  text?: string;
  content?: string;
}

interface GenieQueryAttachment {
  query?: string | null;
  description?: string | null;
  statement_id?: string | null;
  query_result_metadata?: { row_count?: number | null } | null;
  thoughts?: GenieThought[] | null;
}

interface GenieAttachment {
  attachment_id?: string;
  query?: GenieQueryAttachment | null;
  text?: { content?: string | null; purpose?: string | null } | null;
  viz?: { query_attachment_id?: string | null } | null;
  suggested_questions?: unknown;
}

/** The raw_payload fields this mapper reads. Everything else passes by. */
interface GenieMessagePayload {
  message_id?: string;
  conversation_id?: string | null;
  user_id?: number | null;
  content?: string | null;
  status?: string | null;
  created_timestamp?: number | null;
  last_updated_timestamp?: number | null;
  auto_regenerate_count?: number | null;
  attachments?: GenieAttachment[] | null;
}

/** Thought order the capture showed; DESCRIPTION is dropped (duplicate). */
const THOUGHT_ORDER = ["UNDERSTANDING", "DATA_SOURCING", "STEPS"] as const;
const DROPPED_THOUGHT_TYPE = "DESCRIPTION";
const THOUGHT_TYPE_PREFIX = "THOUGHT_TYPE_";

/** "THOUGHT_TYPE_UNDERSTANDING" and "UNDERSTANDING" both → "UNDERSTANDING". */
function thoughtTypeOf(thought: GenieThought): string {
  const raw = thought.thought_type ?? thought.type ?? "";
  return raw.startsWith(THOUGHT_TYPE_PREFIX)
    ? raw.slice(THOUGHT_TYPE_PREFIX.length)
    : raw;
}

const MS_THRESHOLD = 1_000_000_000_000;

/** Databricks stamps some timestamps in seconds, some in ms — normalize. */
function toMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < MS_THRESHOLD ? value * 1000 : value;
}

function msToNano(ms: number): string {
  return `${Math.round(ms)}000000`;
}

/** 16-byte trace id / 8-byte span id, hex, derived from stable coordinates. */
function hashId(material: string, hexLength: 32 | 16): string {
  return createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, hexLength);
}

type OtlpJsonAttr = {
  key: string;
  value: { stringValue?: string; intValue?: number };
};

function stringAttr(key: string, value: string): OtlpJsonAttr {
  return { key, value: { stringValue: value } };
}

function intAttr(key: string, value: number): OtlpJsonAttr {
  return { key, value: { intValue: value } };
}

/**
 * Flatten the query thoughts into one reasoning text, UNDERSTANDING →
 * DATA_SOURCING → STEPS, unknown types appended in arrival order rather
 * than dropped, DESCRIPTION dropped (byte-identical to query.description,
 * 33/33 in the capture — it becomes the step-row label instead).
 */
export function flattenThoughts(
  attachments: GenieAttachment[] | null | undefined,
): string {
  const thoughts = (attachments ?? []).flatMap(
    (attachment) => attachment.query?.thoughts ?? [],
  );
  const textOf = (thought: GenieThought): string =>
    (thought.text ?? thought.content ?? "").trim();
  const known: string[] = [];
  for (const wanted of THOUGHT_ORDER) {
    for (const thought of thoughts) {
      if (thoughtTypeOf(thought) === wanted && textOf(thought)) {
        known.push(textOf(thought));
      }
    }
  }
  const unknown = thoughts
    .filter((thought) => {
      const type = thoughtTypeOf(thought);
      return (
        type !== DROPPED_THOUGHT_TYPE &&
        !THOUGHT_ORDER.includes(type as (typeof THOUGHT_ORDER)[number]) &&
        textOf(thought)
      );
    })
    .map(textOf);
  return [...known, ...unknown].join("\n\n");
}

/**
 * The context the mapper stamps as receiver-authoritative origin. Matches
 * the push-mode receiver's `stampOriginAttrs` keys so the governance fold
 * and OCSF projections filter routed traces exactly like pushed ones.
 */
export interface GenieRoutingOrigin {
  ingestionSourceId: string;
  organizationId: string;
  sourceType: string;
}

function originAttrs(origin: GenieRoutingOrigin) {
  return [
    stringAttr("langwatch.origin.kind", "ingestion_source"),
    stringAttr("langwatch.ingestion_source.id", origin.ingestionSourceId),
    stringAttr(
      "langwatch.ingestion_source.organization_id",
      origin.organizationId,
    ),
    stringAttr("langwatch.ingestion_source.source_type", origin.sourceType),
    stringAttr(PROVENANCE_ATTR_SOURCE, GENIE_PROVENANCE_SOURCE),
  ];
}

function parsePayload(event: NormalizedPullEvent): GenieMessagePayload {
  try {
    const parsed = JSON.parse(event.raw_payload) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as GenieMessagePayload;
    }
  } catch {
    // Defensive path below renders the question from `extra` instead.
  }
  return {};
}

function extraString(
  event: NormalizedPullEvent,
  key: string,
): string | undefined {
  const value = event.extra?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Map one run's Genie events to a single OTLP trace request. Returns null
 * when nothing routes (no conversation-bearing events in the batch).
 */
export function mapGenieEventsToTraceRequest(
  events: NormalizedPullEvent[],
  origin: GenieRoutingOrigin,
): IExportTraceServiceRequest | null {
  const spans = events
    .filter((event) => event.action === GENIE_QUERY_ACTION)
    .flatMap((event) => mapMessage(event, origin));
  if (spans.length === 0) return null;
  return {
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [
          {
            scope: { name: "langwatch.ingestion.databricks_genie" },
            spans,
          },
        ],
      },
    ],
  } as IExportTraceServiceRequest;
}

// The OTLP span shape assembled here is validated downstream by
// `spanSchema` (schemas/otlp.ts); typing as the transformer interface would
// force protobuf-flavored fields (Uint8Array ids) the JSON path doesn't use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OtlpJsonSpan = any;

function mapMessage(
  event: NormalizedPullEvent,
  origin: GenieRoutingOrigin,
): OtlpJsonSpan[] {
  const payload = parsePayload(event);

  const conversationId =
    payload.conversation_id ??
    extraString(event, "conversationId") ??
    "unknown_conversation";
  const messageId =
    payload.message_id ??
    extraString(event, "messageId") ??
    event.source_event_id;
  const regenCount =
    typeof payload.auto_regenerate_count === "number" &&
    payload.auto_regenerate_count > 0
      ? payload.auto_regenerate_count
      : 0;

  const traceId = hashId(`genie:${conversationId}:${messageId}`, 32);
  const spanSeed = `genie:${conversationId}:${messageId}:${regenCount}`;
  const rootSpanId = hashId(`${spanSeed}:root`, 16);

  const startMs =
    toMs(payload.created_timestamp) ?? Date.parse(event.event_timestamp);
  const endMs = Math.max(
    toMs(payload.last_updated_timestamp) ?? startMs,
    startMs,
  );

  const question = payload.content ?? extraString(event, "question") ?? "";
  const status = (payload.status ?? extraString(event, "status") ?? "").trim();
  const attachments = payload.attachments ?? [];

  // The ANSWER text attachment (35/35 in the capture, refusals included).
  // Purpose is matched when present; a lone text attachment without one
  // still counts — presence of an answer beats strictness on a label.
  const textAttachments = attachments.filter(
    (attachment) => typeof attachment.text?.content === "string",
  );
  const answerAttachment =
    textAttachments.find(
      (attachment) => attachment.text?.purpose === "ANSWER",
    ) ?? textAttachments[0];
  const answerText = answerAttachment?.text?.content ?? "";

  const completed = status === "COMPLETED";
  // Defensive failure marker (Decision 13): never a false success. A
  // non-COMPLETED status or a completed message with no answer text both
  // degrade to a marked failure that still shows the question.
  const assistantContent =
    completed && answerText
      ? answerText
      : `[Genie message ${status || "UNKNOWN_STATUS"} — no answer recorded]`;

  const reasoning = flattenThoughts(attachments);

  const queryAttachments = attachments.filter(
    (attachment) => typeof attachment.query?.query === "string",
  );
  const statementIds = queryAttachments
    .map((attachment) => attachment.query?.statement_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const vizPointers = attachments
    .map((attachment) => attachment.viz?.query_attachment_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const assistantMessage: Record<string, string> = {
    role: "assistant",
    content: assistantContent,
  };
  if (reasoning) assistantMessage.reasoning_content = reasoning;

  const rootAttributes = [
    stringAttr("langwatch.span.type", "llm"),
    stringAttr("langwatch.thread.id", conversationId),
    stringAttr(
      "langwatch.input",
      JSON.stringify({
        type: "chat_messages",
        value: [{ role: "user", content: question }],
      }),
    ),
    stringAttr(
      "langwatch.output",
      JSON.stringify({ type: "chat_messages", value: [assistantMessage] }),
    ),
    // Agent identity, not a priced model (Decision 14(d) pins no price match).
    stringAttr("gen_ai.request.model", GENIE_AGENT_MODEL),
    stringAttr("databricks.genie.message_id", messageId),
    stringAttr("databricks.genie.conversation_id", conversationId),
    ...originAttrs(origin),
  ];
  // The author as the provider's raw numeric id (Decision 13): resolved to a
  // person at READ time by the identity stack (ADR-094), never at pull time.
  const rawUserId =
    payload.user_id != null
      ? String(payload.user_id)
      : extraString(event, "actorUserId");
  if (rawUserId)
    rootAttributes.push(stringAttr("langwatch.user.id", rawUserId));
  if (status)
    rootAttributes.push(stringAttr("databricks.genie.status", status));
  if (regenCount > 0) {
    rootAttributes.push(
      intAttr("databricks.genie.auto_regenerate_count", regenCount),
    );
  }
  const spaceId = extraString(event, "spaceId");
  if (spaceId)
    rootAttributes.push(stringAttr("databricks.genie.space_id", spaceId));
  if (statementIds.length > 0) {
    // ALL statement ids (Decision 12): the display-time join key to the
    // warehouse spend ledger — a multi-statement answer never undercounts.
    rootAttributes.push(
      stringAttr(
        "databricks.genie.statement_ids",
        JSON.stringify(statementIds),
      ),
    );
  }
  if (vizPointers.length > 0) {
    // A pointer, not chart data — stored, never rendered (Decision 12).
    rootAttributes.push(
      stringAttr(
        "databricks.genie.viz_query_attachment_ids",
        JSON.stringify(vizPointers),
      ),
    );
  }
  // `suggested_questions` are deliberately never read: Genie's offered
  // follow-ups are not something a person said (Decision 12).
  // Token counts are deliberately never copied from the puller's literal
  // zeros: the `llm` span type makes the estimator count the text and stamp
  // `langwatch.tokens.estimated = true` (Decision 12).

  const rootSpan: OtlpJsonSpan = {
    traceId,
    spanId: rootSpanId,
    name: GENIE_MESSAGE_SPAN_NAME,
    kind: "SPAN_KIND_INTERNAL",
    startTimeUnixNano: msToNano(startMs),
    endTimeUnixNano: msToNano(endMs),
    attributes: rootAttributes,
    status: completed ? { code: 1 } : { code: 2, message: status || "unknown" },
  };

  const stepSpans = queryAttachments.map((attachment, index) => {
    const stepKey = attachment.attachment_id ?? `index:${index}`;
    const rowCount = attachment.query?.query_result_metadata?.row_count;
    const params: Record<string, unknown> = {
      tool_name: attachment.query?.description || "SQL query",
      full_command: attachment.query?.query ?? "",
    };
    if (attachment.query?.statement_id) {
      params.statement_id = attachment.query.statement_id;
    }
    if (typeof rowCount === "number") params.row_count = rowCount;
    return {
      traceId,
      spanId: hashId(`${spanSeed}:query:${stepKey}`, 16),
      parentSpanId: rootSpanId,
      name: GENIE_QUERY_SPAN_NAME,
      kind: "SPAN_KIND_INTERNAL",
      startTimeUnixNano: msToNano(startMs),
      endTimeUnixNano: msToNano(endMs),
      attributes: [
        stringAttr("langwatch.span.type", "tool"),
        stringAttr("langwatch.params", JSON.stringify(params)),
        ...originAttrs(origin),
      ],
      status: { code: completed ? 1 : 2 },
    } satisfies OtlpJsonSpan;
  });

  return [rootSpan, ...stepSpans];
}

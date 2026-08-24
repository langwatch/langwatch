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
 * Identity (Decision 10): trace id = hash(ingestion_source_id +
 * conversation_id + message_id), span ids = the same plus
 * `auto_regenerate_count`, thread id = source + conversation. The source
 * namespace is load-bearing — provider ids are unique per Genie workspace,
 * not globally, and one destination project can take pulls from several
 * sources. The event store is first-write-wins per span id, so an unchanged
 * re-pull is a durable no-op and a REGENERATED answer (bumped count) lands as
 * a new attempt entry beside the original instead of being silently dropped.
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
import { TERMINAL_MESSAGE_STATUSES } from "./databricksGenie.puller";
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
    .filter((event) => isSettledForRouting(event))
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

/** Identity, timing, status, and origin derived once per message. */
interface GenieMessageFrame {
  payload: GenieMessagePayload;
  origin: GenieRoutingOrigin;
  conversationId: string;
  messageId: string;
  regenCount: number;
  traceId: string;
  /** `conversationId` namespaced by source — the explorer's grouping key. */
  threadId: string;
  spanSeed: string;
  rootSpanId: string;
  startMs: number;
  endMs: number;
  status: string;
  isCompleted: boolean;
}

/**
 * Only settled messages are routed — a message a sweep caught mid-answer must
 * NOT be: the trace pipeline dedups spans by `tenant:traceId:spanId` and keeps
 * the FIRST write, so routing a mid-flight capture pins an answerless, errored
 * trace that the completed re-send (same deterministic ids) can never repair.
 * Observed live: a message swept during ASKING_AI stayed "[Genie message
 * ASKING_AI — no answer recorded]" forever while the audit row updated.
 *
 * "Settled" is the puller's call, not a second list here: it owns
 * `TERMINAL_MESSAGE_STATUSES` and — for the same lose-the-record reason —
 * holds the watermark on unsettled messages for up to an hour, so a skipped
 * message keeps getting re-read until it settles. Its polarity applies too: an
 * UNRECOGNISED non-empty status counts as in-flight, because being wrong that
 * way costs a re-read where routing it costs a permanently wrong trace. A
 * message with no status at all is routed as it stands (Decision 13's failure
 * marker) — the puller likewise never holds the watermark for it, so a skip
 * here would drop it from the trace sink outright.
 */
function isSettledForRouting(event: NormalizedPullEvent): boolean {
  const payload = parsePayload(event);
  const status = (payload.status ?? extraString(event, "status") ?? "").trim();
  return status === "" || TERMINAL_MESSAGE_STATUSES.has(status);
}

function frameOf(
  event: NormalizedPullEvent,
  origin: GenieRoutingOrigin,
): GenieMessageFrame {
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
  // Every derived identity is namespaced by the ingestion source.
  //
  // `conversation_id` and `message_id` are unique WITHIN a Genie workspace, and
  // one destination project can receive pulls from more than one source. Two
  // sources are two independent identifier domains, so an unqualified seed
  // gambles on their values never meeting — and the failure is silent in all
  // three directions: equal span ids dedupe the second conversation away at
  // `tenant:trace:span` (first write wins, permanently — the Redis gate is only
  // the fast path), and an equal thread id interleaves two workspaces' turns
  // into one rendered conversation.
  const identityNamespace = `genie:${origin.ingestionSourceId}`;
  const spanSeed = `${identityNamespace}:${conversationId}:${messageId}:${regenCount}`;
  // Both timestamp sources can be garbage (mapToOcsfRow guards the same
  // field). NaN here would serialize as "NaN000000" and fail spanSchema,
  // dropping the whole conversation — degrade to pull time instead.
  const eventMs = Date.parse(event.event_timestamp);
  const startMs =
    toMs(payload.created_timestamp) ??
    (Number.isFinite(eventMs) ? eventMs : Date.now());
  const status = (payload.status ?? extraString(event, "status") ?? "").trim();
  return {
    payload,
    origin,
    conversationId,
    messageId,
    regenCount,
    traceId: hashId(`${identityNamespace}:${conversationId}:${messageId}`, 32),
    threadId: `${origin.ingestionSourceId}:${conversationId}`,
    spanSeed,
    rootSpanId: hashId(`${spanSeed}:root`, 16),
    startMs,
    endMs: Math.max(toMs(payload.last_updated_timestamp) ?? startMs, startMs),
    status,
    isCompleted: status === "COMPLETED",
  };
}

/**
 * The assistant bubble's text. The ANSWER text attachment (35/35 in the
 * capture, refusals included) — the wire value is the enum-prefixed
 * "TEXT_ATTACHMENT_PURPOSE_ANSWER" (verified against the raw capture); bare
 * "ANSWER" is tolerated. A lone text attachment without a purpose still
 * counts — presence of an answer beats strictness on a label.
 */
function assistantContentOf(
  frame: GenieMessageFrame,
  attachments: GenieAttachment[],
): string {
  const textAttachments = attachments.filter(
    (attachment) => typeof attachment.text?.content === "string",
  );
  const answerAttachment =
    textAttachments.find((attachment) =>
      (attachment.text?.purpose ?? "").endsWith("ANSWER"),
    ) ?? textAttachments[0];
  const answerText = answerAttachment?.text?.content ?? "";
  // Defensive failure marker (Decision 13): never a false success. A
  // non-COMPLETED status or a completed message with no answer text both
  // degrade to a marked failure that still shows the question.
  return frame.isCompleted && answerText
    ? answerText
    : `[Genie message ${frame.status || "UNKNOWN_STATUS"} — no answer recorded]`;
}

function rootAttributesOf(
  event: NormalizedPullEvent,
  frame: GenieMessageFrame,
): OtlpJsonAttr[] {
  const attachments = frame.payload.attachments ?? [];
  const question =
    frame.payload.content ?? extraString(event, "question") ?? "";
  const assistantMessage: Record<string, string> = {
    role: "assistant",
    content: assistantContentOf(frame, attachments),
  };
  const reasoning = flattenThoughts(attachments);
  if (reasoning) assistantMessage.reasoning_content = reasoning;
  return [
    stringAttr("langwatch.span.type", "llm"),
    stringAttr("langwatch.thread.id", frame.threadId),
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
    stringAttr("databricks.genie.message_id", frame.messageId),
    stringAttr("databricks.genie.conversation_id", frame.conversationId),
    ...originAttrs(frame.origin),
    ...optionalRootAttributes(event, frame),
  ];
}

function optionalRootAttributes(
  event: NormalizedPullEvent,
  frame: GenieMessageFrame,
): OtlpJsonAttr[] {
  const attachments = frame.payload.attachments ?? [];
  const attributes: OtlpJsonAttr[] = [];
  // The author as the provider's raw numeric id (Decision 13): resolved to a
  // person at READ time by the identity stack (ADR-094), never at pull time.
  const rawUserId =
    frame.payload.user_id != null
      ? String(frame.payload.user_id)
      : extraString(event, "actorUserId");
  if (rawUserId) attributes.push(stringAttr("langwatch.user.id", rawUserId));
  if (frame.status) {
    attributes.push(stringAttr("databricks.genie.status", frame.status));
  }
  if (frame.regenCount > 0) {
    attributes.push(
      intAttr("databricks.genie.auto_regenerate_count", frame.regenCount),
    );
  }
  const spaceId = extraString(event, "spaceId");
  if (spaceId) {
    attributes.push(stringAttr("databricks.genie.space_id", spaceId));
  }
  const statementIds = queryAttachmentsOf(attachments)
    .map((attachment) => attachment.query?.statement_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (statementIds.length > 0) {
    // ALL statement ids (Decision 12): the display-time join key to the
    // warehouse spend ledger — a multi-statement answer never undercounts.
    attributes.push(
      stringAttr(
        "databricks.genie.statement_ids",
        JSON.stringify(statementIds),
      ),
    );
  }
  const vizPointers = attachments
    .map((attachment) => attachment.viz?.query_attachment_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (vizPointers.length > 0) {
    // A pointer, not chart data — stored, never rendered (Decision 12).
    attributes.push(
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
  return attributes;
}

function queryAttachmentsOf(attachments: GenieAttachment[]): GenieAttachment[] {
  return attachments.filter(
    (attachment) => typeof attachment.query?.query === "string",
  );
}

function queryStepSpan(
  attachment: GenieAttachment,
  index: number,
  frame: GenieMessageFrame,
): OtlpJsonSpan {
  const stepKey = attachment.attachment_id ?? `index:${index}`;
  const rowCount = attachment.query?.query_result_metadata?.row_count;
  // Bare keys, not a `langwatch.params` JSON blob: the span read unflattens
  // every attribute onto `Span.params`, so `params.tool_name` only resolves
  // for keys stored bare — the same contract Claude Code's tool spans use,
  // and the one TurnSteps reads (`params.tool_name` / `params.full_command`).
  // A JSON blob under `langwatch.params` gets dot-flattened at the trace door
  // and lands at `params.langwatch.params.*`, where no reader looks.
  const stepAttrs = [
    stringAttr("tool_name", attachment.query?.description || "SQL query"),
    stringAttr("full_command", attachment.query?.query ?? ""),
  ];
  if (attachment.query?.statement_id) {
    stepAttrs.push(stringAttr("statement_id", attachment.query.statement_id));
  }
  if (typeof rowCount === "number") {
    stepAttrs.push(intAttr("row_count", rowCount));
  }
  return {
    traceId: frame.traceId,
    spanId: hashId(`${frame.spanSeed}:query:${stepKey}`, 16),
    parentSpanId: frame.rootSpanId,
    name: GENIE_QUERY_SPAN_NAME,
    kind: "SPAN_KIND_INTERNAL",
    startTimeUnixNano: msToNano(frame.startMs),
    endTimeUnixNano: msToNano(frame.endMs),
    attributes: [
      stringAttr("langwatch.span.type", "tool"),
      ...stepAttrs,
      ...originAttrs(frame.origin),
    ],
    status: { code: frame.isCompleted ? 1 : 2 },
  } satisfies OtlpJsonSpan;
}

function mapMessage(
  event: NormalizedPullEvent,
  origin: GenieRoutingOrigin,
): OtlpJsonSpan[] {
  const frame = frameOf(event, origin);
  const attachments = frame.payload.attachments ?? [];
  const rootSpan: OtlpJsonSpan = {
    traceId: frame.traceId,
    spanId: frame.rootSpanId,
    name: GENIE_MESSAGE_SPAN_NAME,
    kind: "SPAN_KIND_INTERNAL",
    startTimeUnixNano: msToNano(frame.startMs),
    endTimeUnixNano: msToNano(frame.endMs),
    attributes: rootAttributesOf(event, frame),
    status: frame.isCompleted
      ? { code: 1 }
      : { code: 2, message: frame.status || "unknown" },
  };
  const stepSpans = queryAttachmentsOf(attachments).map((attachment, index) =>
    queryStepSpan(attachment, index, frame),
  );
  return [rootSpan, ...stepSpans];
}

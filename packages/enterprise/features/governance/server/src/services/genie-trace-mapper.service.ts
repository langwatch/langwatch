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

import type { exportTraceServiceRequestSchema } from "@langwatch/trace-contract";
import type { z } from "zod";
import {
  type ConversationRoutingProfile,
  type ConversationSeeds,
  ConversationTraceAssemblyService,
  type OtlpJsonSpan,
} from "./conversation-trace-assembly.service.ts";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import { GenieSpanAttributesService } from "./genie-span-attributes.service.ts";
import { nowInstant } from "@langwatch/time";
import type {
  GenieMessageFrame,
  GenieMessagePayload,
  GenieRoutingOrigin,
} from "../rules/genie-message.rules.ts";

type ExportTraceServiceRequest = z.input<typeof exportTraceServiceRequestSchema>;

/** Root span (the turn itself, `llm`-typed so the estimator runs). */
/**
 * Statuses that mean the message will not change again.
 *
 * Genie populates `attachments` PROGRESSIVELY: a message is answerable while it
 * is still `PENDING_WAREHOUSE` or `EXECUTING_QUERY`, and the generated SQL —
 * the artefact this adapter exists to capture — may not be there yet. Reading
 * one mid-flight and letting the watermark move past it loses that SQL
 * permanently, because nothing ever asks for the message again.
 *
 * An UNRECOGNISED non-empty status counts as non-terminal on purpose. A status
 * Databricks adds later is far more likely to be another in-flight state than a
 * new way of being finished, and being wrong in this direction costs a re-read
 * where the other direction costs the record.
 *
 * A message with no status at all is left alone: some responses omit it, and
 * treating absent as in-flight would hold the watermark on every sweep forever.
 */
export const TERMINAL_MESSAGE_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "QUERY_RESULT_EXPIRED",
]);

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

/** The action Genie's own profile counts as a conversation. */
export const GENIE_QUERY_ACTION = "genie_query" as const;

export const GENIE_ROUTING_PROFILE: ConversationRoutingProfile = {
  conversationAction: GENIE_QUERY_ACTION,
  agentModel: GENIE_AGENT_MODEL,
  provenanceSource: GENIE_PROVENANCE_SOURCE,
  scopeName: "langwatch.ingestion.databricks_genie",
  identityNamespace: "genie",
};

/**
 * Databricks Genie conversations mapped to traces.
 *
 * The sibling of {@link CopilotStudioTraceMapperService} and the same shape: one job
 * with many steps, of which exactly one — `tryToTraceRequest` — is anybody
 * else's business. `flattenThoughts` used to be exported alongside it with no
 * caller anywhere.
 */
export class GenieTraceMapperService {
  static create(): GenieTraceMapperService {
    return new GenieTraceMapperService();
  }

  private static parsePayload(event: NormalizedPullEvent): GenieMessagePayload {
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
  private static isSettledForRouting(event: NormalizedPullEvent): boolean {
    const payload = GenieTraceMapperService.parsePayload(event);
    const status = (
      payload.status ??
      GenieSpanAttributesService.tryExtraString(event, "status") ??
      ""
    ).trim();

    return status === "" || TERMINAL_MESSAGE_STATUSES.has(status);
  }

  private static frameOf(
    event: NormalizedPullEvent,
    origin: GenieRoutingOrigin,
  ): GenieMessageFrame {
    const payload = GenieTraceMapperService.parsePayload(event);
    const conversationId =
      payload.conversation_id ??
      GenieSpanAttributesService.tryExtraString(event, "conversationId") ??
      "unknown_conversation";
    const messageId =
      payload.message_id ??
      GenieSpanAttributesService.tryExtraString(event, "messageId") ??
      event.source_event_id;
    const regenCount =
      typeof payload.auto_regenerate_count === "number" && payload.auto_regenerate_count > 0
        ? payload.auto_regenerate_count
        : 0;
    // Which fields name what; the shared assembly namespaces and hashes them.
    //
    // A Genie trace is one question and its answer, so a message id is part of
    // naming the trace. A thread is the conversation those questions belong to.
    // A span additionally carries the regeneration count, so a regenerated
    // answer becomes a new attempt under the same trace rather than overwriting
    // the first one.
    const seeds: ConversationSeeds = {
      trace: [conversationId, messageId],
      thread: [conversationId],
      span: [conversationId, messageId, regenCount],
    };
    const identity = ConversationTraceAssemblyService.deriveConversationIdentity(origin, seeds);
    // Both timestamp sources can be garbage (mapToOcsfRow guards the same
    // field). NaN here would serialize as "NaN000000" and fail spanSchema,
    // dropping the whole conversation — degrade to pull time instead.
    const eventMs = Date.parse(event.event_timestamp);
    const startMs =
      GenieSpanAttributesService.tryToMs(payload.created_timestamp) ??
      (Number.isFinite(eventMs) ? eventMs : nowInstant().epochMilliseconds);
    const status = (
      payload.status ??
      GenieSpanAttributesService.tryExtraString(event, "status") ??
      ""
    ).trim();

    return {
      payload,
      origin,
      conversationId,
      messageId,
      regenCount,
      traceId: identity.traceId,
      threadId: identity.threadId,
      spanSeed: identity.spanSeed,
      rootSpanId: identity.rootSpanId,
      startMs,
      endMs: Math.max(
        GenieSpanAttributesService.tryToMs(payload.last_updated_timestamp) ?? startMs,
        startMs,
      ),
      status,
      isCompleted: status === "COMPLETED",
    };
  }

  private static mapMessage(
    event: NormalizedPullEvent,
    origin: GenieRoutingOrigin,
  ): OtlpJsonSpan[] {
    const frame = GenieTraceMapperService.frameOf(event, origin);
    const attachments = frame.payload.attachments ?? [];
    const rootSpan: OtlpJsonSpan = {
      traceId: frame.traceId,
      spanId: frame.rootSpanId,
      name: GENIE_MESSAGE_SPAN_NAME,
      kind: "SPAN_KIND_INTERNAL",
      startTimeUnixNano: ConversationTraceAssemblyService.msToNano(frame.startMs),
      endTimeUnixNano: ConversationTraceAssemblyService.msToNano(frame.endMs),
      attributes: GenieSpanAttributesService.rootAttributesOf(event, frame),
      status: frame.isCompleted ? { code: 1 } : { code: 2, message: frame.status || "unknown" },
    };
    const stepSpans = GenieSpanAttributesService.queryAttachmentsOf(attachments).map(
      (attachment, index) => GenieSpanAttributesService.queryStepSpan(attachment, index, frame),
    );

    return [rootSpan, ...stepSpans];
  }

  /**
   * Map one run's conversation events to a single OTLP trace request. Returns
   * null when nothing routes (no conversation-bearing events in the batch).
   *
   * The action filter is the last guard standing between a source's events and
   * a customer's trace project: `routeConversationsToTraceDestination` runs for
   * every source, the destination column is written without any check of the
   * source type, and `mapMessage` below builds a span for whatever it is given.
   * Without this line an Anthropic Admin source that acquired a destination
   * would have its billing rows rendered as messages someone said.
   */
  static tryToTraceRequest({
    events,
    origin,
  }: {
    events: NormalizedPullEvent[];
    origin: GenieRoutingOrigin;
  }): ExportTraceServiceRequest | null {
    // `action` is typed as a string but arrives from a puller's own mapping, so
    // an event that never set one reads as undefined at runtime. Requiring a
    // non-empty action on both sides keeps two absences from matching each
    // other and routing an event nothing ever claimed.
    const wanted = origin.profile.conversationAction;
    const spans = (wanted ? events : [])
      .filter((event) => !!event.action && event.action === wanted)
      .filter((event) => GenieTraceMapperService.isSettledForRouting(event))
      .flatMap((event) => GenieTraceMapperService.mapMessage(event, origin));

    return ConversationTraceAssemblyService.tryAssembleTraceRequest(spans, origin.profile);
  }
}

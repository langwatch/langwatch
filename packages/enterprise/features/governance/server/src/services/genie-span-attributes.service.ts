// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a Genie message looks like as spans: the assistant bubble's text, the root span's
 * attributes, and one child span per query attachment. The mapper decides which messages become a
 * trace; this decides what each one carries.
 */

import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import {
  ConversationTraceAssemblyService,
  type OtlpJsonAttr,
  type OtlpJsonSpan,
} from "./conversation-trace-assembly.service.ts";
import {
  DROPPED_THOUGHT_TYPE,
  MS_THRESHOLD,
  THOUGHT_ORDER,
  THOUGHT_TYPE_PREFIX,
  type GenieAttachment,
  type GenieMessageFrame,
  type GenieThought,
} from "../rules/genie-message.rules.ts";
import { GENIE_QUERY_SPAN_NAME } from "./genie-trace-mapper.service.ts";

export class GenieSpanAttributesService {
  private constructor() {}

  static create(): GenieSpanAttributesService {
    return new GenieSpanAttributesService();
  }

  /** "THOUGHT_TYPE_UNDERSTANDING" and "UNDERSTANDING" both → "UNDERSTANDING". */
  static thoughtTypeOf(thought: GenieThought): string {
    const raw = thought.thought_type ?? thought.type ?? "";

    return raw.startsWith(THOUGHT_TYPE_PREFIX) ? raw.slice(THOUGHT_TYPE_PREFIX.length) : raw;
  }

  /** Databricks stamps some timestamps in seconds, some in ms — normalize. */
  static tryToMs(value: number | null | undefined): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value < MS_THRESHOLD ? value * 1000 : value;
  }

  /**
   * Flatten the query thoughts into one reasoning text, UNDERSTANDING →
   * DATA_SOURCING → STEPS, unknown types appended in arrival order rather
   * than dropped, DESCRIPTION dropped (byte-identical to query.description,
   * 33/33 in the capture — it becomes the step-row label instead).
   */
  static flattenThoughts(attachments: GenieAttachment[] | null | undefined): string {
    const thoughts = (attachments ?? []).flatMap((attachment) => attachment.query?.thoughts ?? []);
    const textOf = (thought: GenieThought): string =>
      (thought.text ?? thought.content ?? "").trim();
    const known: string[] = [];
    for (const wanted of THOUGHT_ORDER) {
      for (const thought of thoughts) {
        if (GenieSpanAttributesService.thoughtTypeOf(thought) === wanted && textOf(thought)) {
          known.push(textOf(thought));
        }
      }
    }

    const unknown = thoughts
      .filter((thought) => {
        const type = GenieSpanAttributesService.thoughtTypeOf(thought);

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
   * The assistant bubble's text. The ANSWER text attachment (35/35 in the
   * capture, refusals included) — the wire value is the enum-prefixed
   * "TEXT_ATTACHMENT_PURPOSE_ANSWER" (verified against the raw capture); bare
   * "ANSWER" is tolerated. A lone text attachment without a purpose still
   * counts — presence of an answer beats strictness on a label.
   */
  static tryExtraString(event: NormalizedPullEvent, key: string): string | undefined {
    const value = event.extra?.[key];

    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  static assistantContentOf(frame: GenieMessageFrame, attachments: GenieAttachment[]): string {
    const textAttachments = attachments.filter(
      (attachment) => typeof attachment.text?.content === "string",
    );
    const answerAttachment =
      textAttachments.find((attachment) => (attachment.text?.purpose ?? "").endsWith("ANSWER")) ??
      textAttachments[0];
    const answerText = answerAttachment?.text?.content ?? "";

    // Defensive failure marker (Decision 13): never a false success. A
    // non-COMPLETED status or a completed message with no answer text both
    // degrade to a marked failure that still shows the question.
    return frame.isCompleted && answerText
      ? answerText
      : `[Genie message ${frame.status || "UNKNOWN_STATUS"} — no answer recorded]`;
  }

  static rootAttributesOf(event: NormalizedPullEvent, frame: GenieMessageFrame): OtlpJsonAttr[] {
    const attachments = frame.payload.attachments ?? [];
    const question =
      frame.payload.content ?? GenieSpanAttributesService.tryExtraString(event, "question") ?? "";
    const assistantMessage: Record<string, string> = {
      role: "assistant",
      content: GenieSpanAttributesService.assistantContentOf(frame, attachments),
    };
    const reasoning = GenieSpanAttributesService.flattenThoughts(attachments);
    if (reasoning) {
      assistantMessage.reasoning_content = reasoning;
    }

    return [
      ConversationTraceAssemblyService.stringAttr({ key: "langwatch.span.type", value: "llm" }),
      ConversationTraceAssemblyService.stringAttr({
        key: "langwatch.thread.id",
        value: frame.threadId,
      }),
      ConversationTraceAssemblyService.stringAttr({
        key: "langwatch.input",
        value: JSON.stringify({
          type: "chat_messages",
          value: [{ role: "user", content: question }],
        }),
      }),
      ConversationTraceAssemblyService.stringAttr({
        key: "langwatch.output",
        value: JSON.stringify({
          type: "chat_messages",
          value: [assistantMessage],
        }),
      }),
      // Agent identity, not a priced model (Decision 14(d) pins no price match).
      // Now that the value varies, `KNOWN_AGENT_IDENTITIES` is what keeps it
      // true — at compile time only. Every profile is a code literal the
      // compiler checks, so nothing re-checks this at runtime.
      ConversationTraceAssemblyService.stringAttr({
        key: "gen_ai.request.model",
        value: frame.origin.profile.agentModel,
      }),
      ConversationTraceAssemblyService.stringAttr({
        key: "databricks.genie.message_id",
        value: frame.messageId,
      }),
      ConversationTraceAssemblyService.stringAttr({
        key: "databricks.genie.conversation_id",
        value: frame.conversationId,
      }),
      ...ConversationTraceAssemblyService.originAttrs(frame.origin),
      ...GenieSpanAttributesService.optionalRootAttributes(event, frame),
    ];
  }

  static optionalRootAttributes(
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
        : GenieSpanAttributesService.tryExtraString(event, "actorUserId");
    if (rawUserId) {
      attributes.push(
        ConversationTraceAssemblyService.stringAttr({ key: "langwatch.user.id", value: rawUserId }),
      );
    }

    if (frame.status) {
      attributes.push(
        ConversationTraceAssemblyService.stringAttr({
          key: "databricks.genie.status",
          value: frame.status,
        }),
      );
    }

    if (frame.regenCount > 0) {
      attributes.push(
        ConversationTraceAssemblyService.intAttr({
          key: "databricks.genie.auto_regenerate_count",
          value: frame.regenCount,
        }),
      );
    }

    const spaceId = GenieSpanAttributesService.tryExtraString(event, "spaceId");
    if (spaceId) {
      attributes.push(
        ConversationTraceAssemblyService.stringAttr({
          key: "databricks.genie.space_id",
          value: spaceId,
        }),
      );
    }

    const statementIds = GenieSpanAttributesService.queryAttachmentsOf(attachments)
      .map((attachment) => attachment.query?.statement_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (statementIds.length > 0) {
      // ALL statement ids (Decision 12): the display-time join key to the
      // warehouse spend ledger — a multi-statement answer never undercounts.
      attributes.push(
        ConversationTraceAssemblyService.stringAttr({
          key: "databricks.genie.statement_ids",
          value: JSON.stringify(statementIds),
        }),
      );
    }

    const vizPointers = attachments
      .map((attachment) => attachment.viz?.query_attachment_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (vizPointers.length > 0) {
      // A pointer, not chart data — stored, never rendered (Decision 12).
      attributes.push(
        ConversationTraceAssemblyService.stringAttr({
          key: "databricks.genie.viz_query_attachment_ids",
          value: JSON.stringify(vizPointers),
        }),
      );
    }

    // `suggested_questions` are deliberately never read: Genie's offered
    // follow-ups are not something a person said (Decision 12).
    // Token counts are deliberately never copied from the puller's literal
    // zeros: the `llm` span type makes the estimator count the text and stamp
    // `langwatch.tokens.estimated = true` (Decision 12).
    return attributes;
  }

  static queryAttachmentsOf(attachments: GenieAttachment[]): GenieAttachment[] {
    return attachments.filter((attachment) => typeof attachment.query?.query === "string");
  }

  static queryStepSpan(
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
      ConversationTraceAssemblyService.stringAttr({
        key: "tool_name",
        value: attachment.query?.description || "SQL query",
      }),
      ConversationTraceAssemblyService.stringAttr({
        key: "full_command",
        value: attachment.query?.query ?? "",
      }),
    ];
    if (attachment.query?.statement_id) {
      stepAttrs.push(
        ConversationTraceAssemblyService.stringAttr({
          key: "statement_id",
          value: attachment.query.statement_id,
        }),
      );
    }

    if (typeof rowCount === "number") {
      stepAttrs.push(
        ConversationTraceAssemblyService.intAttr({ key: "row_count", value: rowCount }),
      );
    }

    return {
      traceId: frame.traceId,
      spanId: ConversationTraceAssemblyService.hashId(`${frame.spanSeed}:query:${stepKey}`, 16),
      parentSpanId: frame.rootSpanId,
      name: GENIE_QUERY_SPAN_NAME,
      kind: "SPAN_KIND_INTERNAL",
      startTimeUnixNano: ConversationTraceAssemblyService.msToNano(frame.startMs),
      endTimeUnixNano: ConversationTraceAssemblyService.msToNano(frame.endMs),
      attributes: [
        ConversationTraceAssemblyService.stringAttr({ key: "langwatch.span.type", value: "tool" }),
        ...stepAttrs,
        ...ConversationTraceAssemblyService.originAttrs(frame.origin),
      ],
      status: { code: frame.isCompleted ? 1 : 2 },
    } satisfies OtlpJsonSpan;
  }
}

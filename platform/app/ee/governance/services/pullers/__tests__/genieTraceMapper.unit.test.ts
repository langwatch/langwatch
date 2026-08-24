// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Genie conversation → OTLP mapping, pinned against ADR-088 v7.
 *
 * The fixtures mirror the 35-message capture's shape (envelope stripped —
 * the puller's raw_payload is the message alone). The synthetic FAILED
 * message exists because the capture holds only COMPLETED messages; a real
 * one replaces it when captured (pending.md research item 3).
 *
 * The cost pin (Decision 14(d)) is the one test here that guards money:
 * cost enrichment runs unconditionally on `llm` spans, and Genie stays
 * cost-free only because "databricks/genie" resolves to no price row. If
 * someone ever adds that model to the registry, this fails loudly instead
 * of dollars silently appearing on routed conversations.
 */

import { describe, expect, it } from "vitest";
import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";
import { spanSchema } from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  GENIE_AGENT_MODEL,
  GENIE_MESSAGE_SPAN_NAME,
  GENIE_QUERY_SPAN_NAME,
  mapGenieEventsToTraceRequest,
} from "../genieTraceMapper";
import type { NormalizedPullEvent } from "../pullerAdapter";

const ORIGIN = {
  ingestionSourceId: "source-1",
  organizationId: "org-1",
  sourceType: "databricks_genie",
};

function genieEvent(
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): NormalizedPullEvent {
  return {
    source_event_id: String(message.message_id ?? "msg-1"),
    event_timestamp: "2026-08-20T10:00:00.000Z",
    actor: "analyst@acme.example",
    action: "genie_query",
    target: "Sales space",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(message),
    extra: {
      conversationId: "conv-1",
      messageId: String(message.message_id ?? "msg-1"),
      ...extra,
    },
  };
}

/** A COMPLETED message shaped like the capture: answer, thoughts, one query. */
function completedMessage(overrides: Record<string, unknown> = {}) {
  return {
    message_id: "msg-1",
    conversation_id: "conv-1",
    user_id: 90210,
    content: "Which region sold most in Q2?",
    status: "COMPLETED",
    created_timestamp: 1755684000, // seconds — the shape Databricks sends
    attachments: [
      {
        attachment_id: "att-q1",
        query: {
          query: "SELECT region, SUM(amount) FROM sales GROUP BY region",
          description: "Total sales by region",
          statement_id: "stmt-1",
          query_result_metadata: { row_count: 4 },
          // The real wire shape: `thought_type` key, enum-prefixed values,
          // text under `content` (verified against the raw capture).
          thoughts: [
            {
              thought_type: "THOUGHT_TYPE_DESCRIPTION",
              content: "Total sales by region",
            },
            {
              thought_type: "THOUGHT_TYPE_STEPS",
              content: "Group by region, sum amount",
            },
            {
              thought_type: "THOUGHT_TYPE_UNDERSTANDING",
              content: "User wants regional totals",
            },
            {
              thought_type: "THOUGHT_TYPE_DATA_SOURCING",
              content: "Use the sales table",
            },
          ],
        },
      },
      {
        attachment_id: "att-a1",
        text: {
          content: "EMEA sold the most in Q2.",
          purpose: "TEXT_ATTACHMENT_PURPOSE_ANSWER",
        },
      },
      {
        attachment_id: "att-s1",
        suggested_questions: ["What about Q3?"],
      },
      {
        attachment_id: "att-v1",
        viz: { query_attachment_id: "att-q1" },
      },
    ],
    ...overrides,
  };
}

function attrsOf(span: { attributes?: { key: string; value: unknown }[] }) {
  return Object.fromEntries(
    (span.attributes ?? []).map((a) => [
      a.key,
      (a.value as { stringValue?: string; intValue?: number }).stringValue ??
        (a.value as { intValue?: number }).intValue,
    ]),
  );
}

function spansOf(events: NormalizedPullEvent[]) {
  const request = mapGenieEventsToTraceRequest(events, ORIGIN);
  return request?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
}

describe("given a completed Genie message from the capture shape", () => {
  const spans = spansOf([genieEvent(completedMessage())]);
  const root = spans.find((s) => s.name === GENIE_MESSAGE_SPAN_NAME)!;
  const step = spans.find((s) => s.name === GENIE_QUERY_SPAN_NAME)!;
  const rootAttrs = attrsOf(root);

  it("emits one llm root span and one tool step span that both pass the OTLP schema", () => {
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(spanSchema.safeParse(span).success).toBe(true);
    }
    expect(rootAttrs["langwatch.span.type"]).toBe("llm");
    expect(attrsOf(step)["langwatch.span.type"]).toBe("tool");
    expect(step.parentSpanId).toBe(root.spanId);
  });

  it("renders the user question and the ANSWER attachment as the chat turn", () => {
    const input = JSON.parse(rootAttrs["langwatch.input"] as string);
    const output = JSON.parse(rootAttrs["langwatch.output"] as string);
    expect(input.value[0]).toEqual({
      role: "user",
      content: "Which region sold most in Q2?",
    });
    expect(output.value[0].role).toBe("assistant");
    expect(output.value[0].content).toBe("EMEA sold the most in Q2.");
  });

  it("flattens thoughts UNDERSTANDING → DATA_SOURCING → STEPS and drops DESCRIPTION", () => {
    const output = JSON.parse(rootAttrs["langwatch.output"] as string);
    const reasoning: string = output.value[0].reasoning_content;
    expect(reasoning).toBe(
      "User wants regional totals\n\nUse the sales table\n\nGroup by region, sum amount",
    );
    expect(reasoning).not.toContain("Total sales by region");
  });

  it("picks the ANSWER-purposed text over an earlier non-answer text", () => {
    const twoTexts = completedMessage({
      attachments: [
        {
          attachment_id: "att-note",
          text: {
            content: "A caveat note.",
            purpose: "TEXT_ATTACHMENT_PURPOSE_OTHER",
          },
        },
        {
          attachment_id: "att-answer",
          text: {
            content: "The real answer.",
            purpose: "TEXT_ATTACHMENT_PURPOSE_ANSWER",
          },
        },
      ],
    });
    const [only] = spansOf([genieEvent(twoTexts)]);
    const output = JSON.parse(attrsOf(only!)["langwatch.output"] as string);
    expect(output.value[0].content).toBe("The real answer.");
  });

  it("never leaks suggested_questions into any mapped payload", () => {
    expect(JSON.stringify(spans)).not.toContain("What about Q3?");
  });

  it("carries all statement ids and the viz pointer as plain attributes", () => {
    expect(
      JSON.parse(rootAttrs["databricks.genie.statement_ids"] as string),
    ).toEqual(["stmt-1"]);
    expect(
      JSON.parse(
        rootAttrs["databricks.genie.viz_query_attachment_ids"] as string,
      ),
    ).toEqual(["att-q1"]);
  });

  it("labels the step row with the query description and the SQL as its argument", () => {
    // Bare keys, matching the Claude Code tool-span contract: the span read
    // unflattens every attribute onto `Span.params`, so TurnSteps finds these
    // at `params.tool_name` / `params.full_command`. A `langwatch.params`
    // JSON blob would be dot-flattened at the trace door and never read.
    const stepAttrs = attrsOf(step);
    expect(stepAttrs.tool_name).toBe("Total sales by region");
    expect(stepAttrs.full_command).toContain("SELECT region");
    expect(stepAttrs.row_count).toBe(4);
    expect(stepAttrs.statement_id).toBe("stmt-1");
    expect(stepAttrs["langwatch.params"]).toBeUndefined();
  });

  it("copies no token counts — the puller's literal zeros never become measurements", () => {
    const keys = (root.attributes ?? []).map((a) => a.key);
    expect(keys.filter((k) => k.startsWith("gen_ai.usage."))).toEqual([]);
  });

  it("stamps provenance and the raw numeric author id", () => {
    expect(rootAttrs["langwatch.source"]).toBe("databricks_genie");
    expect(rootAttrs["langwatch.origin.kind"]).toBe("ingestion_source");
    expect(rootAttrs["langwatch.ingestion_source.id"]).toBe("source-1");
    expect(rootAttrs["langwatch.user.id"]).toBe("90210");
    expect(rootAttrs["langwatch.thread.id"]).toBe("source-1:conv-1");
  });
});

describe("given trace identity across re-pulls and regeneration (Decision 10)", () => {
  it("an unchanged re-pull derives byte-identical ids", () => {
    const first = spansOf([genieEvent(completedMessage())]);
    const second = spansOf([genieEvent(completedMessage())]);
    expect(second.map((s) => [s.traceId, s.spanId])).toEqual(
      first.map((s) => [s.traceId, s.spanId]),
    );
  });

  it("a regenerated answer keeps the trace id but mints new span ids — a new attempt entry", () => {
    const original = spansOf([genieEvent(completedMessage())]);
    const regenerated = spansOf([
      genieEvent(completedMessage({ auto_regenerate_count: 1 })),
    ]);
    expect(regenerated[0]!.traceId).toBe(original[0]!.traceId);
    const originalSpanIds = new Set(original.map((s) => s.spanId));
    for (const span of regenerated) {
      expect(originalSpanIds.has(span.spanId)).toBe(false);
    }
  });
});

describe("given a failed message (synthetic — no real one captured yet)", () => {
  const spans = spansOf([
    genieEvent({
      message_id: "msg-failed",
      conversation_id: "conv-1",
      content: "Break the warehouse",
      status: "FAILED",
      created_timestamp: 1755684000,
      attachments: null,
    }),
  ]);
  const root = spans[0]!;
  const rootAttrs = attrsOf(root);

  it("still renders the user's question with a failure marker, never a false success", () => {
    const input = JSON.parse(rootAttrs["langwatch.input"] as string);
    const output = JSON.parse(rootAttrs["langwatch.output"] as string);
    expect(input.value[0].content).toBe("Break the warehouse");
    expect(output.value[0].content).toContain("FAILED");
    expect(root.status).toEqual({ code: 2, message: "FAILED" });
  });
});

describe("given a payload that does not parse", () => {
  it("degrades to the adapter's extra fields instead of dropping the message", () => {
    const broken: NormalizedPullEvent = {
      ...genieEvent(completedMessage()),
      raw_payload: "not-json{",
      extra: {
        conversationId: "conv-9",
        messageId: "msg-9",
        question: "What was pulled?",
        status: "COMPLETED",
      },
    };
    const spans = spansOf([broken]);
    const rootAttrs = attrsOf(spans[0]!);
    const input = JSON.parse(rootAttrs["langwatch.input"] as string);
    expect(input.value[0].content).toBe("What was pulled?");
    // COMPLETED with no answer text is still a marked failure, not a success.
    const output = JSON.parse(rootAttrs["langwatch.output"] as string);
    expect(output.value[0].content).toContain("no answer recorded");
  });
});

describe("given a message with no usable timestamp anywhere", () => {
  it("degrades to a finite clock time instead of NaN-poisoned spans", () => {
    const timeless: NormalizedPullEvent = {
      ...genieEvent(
        completedMessage({
          created_timestamp: undefined,
          last_updated_timestamp: undefined,
        }),
      ),
      event_timestamp: "not-a-timestamp",
    };
    const spans = spansOf([timeless]);
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      // NaN would serialize as "NaN000000" and fail the trace-door schema.
      expect(Number(span.startTimeUnixNano)).toBeGreaterThan(0);
      expect(Number(span.endTimeUnixNano)).toBeGreaterThan(0);
      expect(spanSchema.safeParse(span).success).toBe(true);
    }
  });
});

describe("given events that are not conversations", () => {
  it("routes nothing for aggregate actions (Decision 8: aggregates never route)", () => {
    const aggregate: NormalizedPullEvent = {
      ...genieEvent(completedMessage()),
      action: "usage_bucket",
    };
    expect(mapGenieEventsToTraceRequest([aggregate], ORIGIN)).toBeNull();
  });
});

describe("given a message a sweep caught mid-answer", () => {
  describe("when the status is a known in-flight one", () => {
    it("routes nothing — the trace door keeps the FIRST write per span id, and a pinned mid-flight capture can never be repaired", () => {
      const inFlight = genieEvent(
        completedMessage({ status: "ASKING_AI", attachments: [] }),
      );
      expect(mapGenieEventsToTraceRequest([inFlight], ORIGIN)).toBeNull();
    });
  });

  describe("when the re-read finds the status settled", () => {
    it("routes the message", () => {
      const settled = genieEvent(completedMessage());
      const request = mapGenieEventsToTraceRequest([settled], ORIGIN);
      expect(request).not.toBeNull();
    });
  });

  describe("when the status is unrecognised", () => {
    it("treats it as still in flight — the puller's polarity: wrong that way costs a re-read, routing it costs a permanently wrong trace", () => {
      const unknown = genieEvent(
        completedMessage({ status: "SOMETHING_NEW", attachments: [] }),
      );
      expect(mapGenieEventsToTraceRequest([unknown], ORIGIN)).toBeNull();
    });
  });

  describe("when there is no status at all", () => {
    it("routes the message as it stands — the puller never holds the watermark for it, so skipping would drop it outright", () => {
      const statusless = genieEvent(
        completedMessage({ status: undefined, attachments: [] }),
      );
      const request = mapGenieEventsToTraceRequest([statusless], ORIGIN);
      expect(request).not.toBeNull();
    });
  });
});

describe("given two ingestion sources routing into one destination project", () => {
  // Provider ids are unique per Genie workspace, not globally. Two sources are
  // two identifier domains; equal coordinates must stay distinct traces, or the
  // `tenant:trace:span` first-write dedupe silently swallows the second.
  const SECOND_ORIGIN = { ...ORIGIN, ingestionSourceId: "source-2" };
  const message = completedMessage();

  function rootOf(origin: typeof ORIGIN) {
    const request = mapGenieEventsToTraceRequest([genieEvent(message)], origin);
    const spans = request?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
    return spans.find((s) => s.name === GENIE_MESSAGE_SPAN_NAME)!;
  }

  describe("when both carry the same conversation and message ids", () => {
    const first = rootOf(ORIGIN);
    const second = rootOf(SECOND_ORIGIN);

    it("keeps the traces distinct so neither dedupes the other away", () => {
      expect(first.traceId).not.toBe(second.traceId);
      expect(first.spanId).not.toBe(second.spanId);
    });

    it("keeps the conversations distinct so their turns do not interleave", () => {
      expect(attrsOf(first)["langwatch.thread.id"]).toBe("source-1:conv-1");
      expect(attrsOf(second)["langwatch.thread.id"]).toBe("source-2:conv-1");
    });
  });

  describe("when one source re-pulls the same message", () => {
    it("still produces identical ids, so the re-pull stays a durable no-op", () => {
      const first = rootOf(ORIGIN);
      const again = rootOf(ORIGIN);
      expect(again.traceId).toBe(first.traceId);
      expect(again.spanId).toBe(first.spanId);
    });
  });
});

describe("given the pricing table (Decision 14(d) pin)", () => {
  it("the Genie agent label resolves to no price — cost enrichment yields zero", () => {
    const cost = computeSpanCost({
      attrs: {},
      model: GENIE_AGENT_MODEL,
      promptTokens: 100_000,
      completionTokens: 100_000,
    });
    expect(cost).toBe(0);
  });
});

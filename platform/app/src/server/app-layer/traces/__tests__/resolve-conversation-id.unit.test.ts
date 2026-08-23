/**
 * One resolved source for a trace's conversation id: the drawer header
 * pill, the facet expression, the has/none predicate and the trace-header
 * mapper all read through resolve-conversation-id, so a value the pill
 * displays is always a value the filter can match.
 *
 * Feature: specs/traces-v2/data-layer.feature
 * Rule: A pill's filter queries the same value the pill displays
 */
import { describe, expect, it } from "vitest";

import { mapTraceSummaryToHeader } from "~/server/api/routers/tracesV2";
import {
  type ExpressionCategoricalDef,
  FACET_REGISTRY,
} from "../facet-registry";
import { translateFilterToClickHouse } from "../filter-to-clickhouse";
import { evaluateQueryInMemory } from "../filter-to-clickhouse/evaluate";
import type { InMemoryTrace } from "../filter-to-clickhouse/field-def";
import {
  CONVERSATION_ID_CLICKHOUSE_EXPRESSION,
  resolveConversationId,
} from "../resolve-conversation-id";
import type { TraceSummaryData } from "../types";

function summary(attributes: Record<string, string>): TraceSummaryData {
  return {
    traceId: "trace_1",
    spanCount: 0,
    totalDurationMs: 0,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    attributes,
    annotationIds: [],
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
  } as TraceSummaryData;
}

function traceWith(attributes: Record<string, string>): InMemoryTrace {
  return { summary: summary(attributes) };
}

describe("resolveConversationId", () => {
  it("prefers the canonical key over the legacy keys", () => {
    expect(
      resolveConversationId({
        "gen_ai.conversation.id": "canonical",
        "langgraph.thread_id": "legacy",
      }),
    ).toBe("canonical");
  });

  it("falls through to langgraph.thread_id on rows that never carried the canonical key", () => {
    expect(resolveConversationId({ "langgraph.thread_id": "lg-1" })).toBe(
      "lg-1",
    );
  });

  it("falls through to langwatch.thread_id last", () => {
    expect(resolveConversationId({ "langwatch.thread_id": "lw-1" })).toBe(
      "lw-1",
    );
  });

  it("treats an empty earlier key as absent", () => {
    expect(
      resolveConversationId({
        "gen_ai.conversation.id": "",
        "langgraph.thread_id": "lg-2",
      }),
    ).toBe("lg-2");
  });

  it("returns an empty string when no supported key carries a value", () => {
    expect(resolveConversationId({})).toBe("");
  });
});

describe("the conversation facet resolves the whole key chain", () => {
  const def = FACET_REGISTRY.find(
    (facet): facet is ExpressionCategoricalDef =>
      facet.key === "conversation" && facet.kind === "categorical",
  );

  /** @scenario "Facet read and display resolution never disagree on precedence" */
  it("the facet's in-memory read and the drawer header resolution agree on every key layout", () => {
    expect(def).toBeDefined();
    for (const attributes of [
      { "gen_ai.conversation.id": "c-1" },
      { "langgraph.thread_id": "lg-3" },
      { "langwatch.thread_id": "lw-3" },
      { "gen_ai.conversation.id": "", "langgraph.thread_id": "lg-4" },
      {},
    ]) {
      const facetValue = def!.read!({ summary: summary(attributes) });
      const header = mapTraceSummaryToHeader(summary(attributes));
      expect(facetValue).toBe(resolveConversationId(attributes));
      expect(header.conversationId ?? "").toBe(
        resolveConversationId(attributes),
      );
    }
  });

  /** @scenario "Facet read and display resolution never disagree on precedence" */
  it("the ClickHouse expression spells out every supported key", () => {
    for (const key of [
      "gen_ai.conversation.id",
      "langgraph.thread_id",
      "langwatch.thread_id",
    ]) {
      expect(CONVERSATION_ID_CLICKHOUSE_EXPRESSION).toContain(`'${key}'`);
    }
  });

  /** @scenario "Facet read and display resolution never disagree on precedence" */
  it("compiles equality against the registry expression", () => {
    const compiled = translateFilterToClickHouse(
      'conversation:"lg-5"',
      "tenant-1",
      { from: 0, to: 1 },
    );
    expect(compiled?.sql).toContain(CONVERSATION_ID_CLICKHOUSE_EXPRESSION);
  });
});

describe("filtering by a legacy-key conversation id", () => {
  /** @scenario "Conversation pill on a legacy-key trace filters to that conversation" */
  it("matches in memory where only langgraph.thread_id carries the id", () => {
    const legacyOnly = traceWith({ "langgraph.thread_id": "lg-6" });
    const canonicalOther = traceWith({ "gen_ai.conversation.id": "other" });
    const bare = traceWith({});

    expect(evaluateQueryInMemory('conversation:"lg-6"', legacyOnly)).toBe(true);
    expect(evaluateQueryInMemory('conversation:"lg-6"', canonicalOther)).toBe(
      false,
    );
    expect(evaluateQueryInMemory('conversation:"lg-6"', bare)).toBe(false);
  });

  /** @scenario "has:conversation counts a legacy-key trace as having a conversation" */
  it("has:conversation and none:conversation evaluate legacy-key traces in memory like their SQL predicate", () => {
    const legacyOnly = traceWith({ "langgraph.thread_id": "lg-7" });
    const canonical = traceWith({ "gen_ai.conversation.id": "c-7" });
    const bare = traceWith({});

    const compiled = translateFilterToClickHouse(
      "has:conversation",
      "tenant-1",
      { from: 0, to: 1 },
    );
    expect(compiled?.sql).toContain(CONVERSATION_ID_CLICKHOUSE_EXPRESSION);

    expect(evaluateQueryInMemory("has:conversation", legacyOnly)).toBe(true);
    expect(evaluateQueryInMemory("has:conversation", canonical)).toBe(true);
    expect(evaluateQueryInMemory("has:conversation", bare)).toBe(false);
    expect(evaluateQueryInMemory("none:conversation", bare)).toBe(true);
  });
});

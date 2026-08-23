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

const baseSummary: TraceSummaryData = {
  traceId: "trace_1",
  spanCount: 0,
  totalDurationMs: 0,
  computedIOSchemaVersion: "1",
  computedInput: null,
  computedOutput: null,
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  models: [],
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  outputFromRootSpan: false,
  outputSpanEndTimeMs: 0,
  blockedByGuardrail: false,
  rootSpanType: null,
  containsAi: false,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  topicId: null,
  subTopicId: null,
  annotationIds: [],
  attributes: {},
  traceName: "",
  occurredAt: 0,
  createdAt: 0,
  updatedAt: 0,
  LastEventOccurredAt: 0,
};

function summaryWith(attributes: Record<string, string>): TraceSummaryData {
  return { ...baseSummary, attributes };
}

function traceWith(attributes: Record<string, string>): InMemoryTrace {
  return { summary: summaryWith(attributes) };
}

function categoricalFacet(key: string): ExpressionCategoricalDef {
  const def = FACET_REGISTRY.find(
    (facet): facet is ExpressionCategoricalDef =>
      facet.key === key && facet.kind === "categorical",
  );
  if (!def) throw new Error(`facet "${key}" is not an expression categorical`);
  return def;
}

describe("given the shared conversation id resolver", () => {
  describe("when summaries carry the id under different keys", () => {
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
  });

  describe("when an earlier key holds an empty string", () => {
    it("falls through to the next key instead of returning the empty value", () => {
      expect(
        resolveConversationId({
          "gen_ai.conversation.id": "",
          "langgraph.thread_id": "lg-2",
        }),
      ).toBe("lg-2");
    });
  });

  describe("when no supported key carries a value", () => {
    it("resolves to an empty string", () => {
      expect(resolveConversationId({})).toBe("");
    });
  });
});

describe("given the conversation facet and the drawer header resolution", () => {
  describe("when the same attributes flow through both", () => {
    /** @scenario "Facet read and display resolution never disagree on precedence" */
    it.each([
      [{ "gen_ai.conversation.id": "c-1" }],
      [{ "langgraph.thread_id": "lg-3" }],
      [{ "langwatch.thread_id": "lw-3" }],
      [{ "gen_ai.conversation.id": "", "langgraph.thread_id": "lg-4" }],
      [{}],
    ])("facet read and header conversationId agree for %j", (attributes) => {
      const facetValue = categoricalFacet("conversation").read!({
        summary: summaryWith(attributes),
      });
      const header = mapTraceSummaryToHeader(summaryWith(attributes));
      expect(facetValue).toBe(resolveConversationId(attributes));
      expect(header.conversationId ?? "").toBe(
        resolveConversationId(attributes),
      );
    });

    /** @scenario "Facet read and display resolution never disagree on precedence" */
    it("compiles equality against the registry expression spelling out every key", () => {
      const compiled = translateFilterToClickHouse(
        'conversation:"lg-5"',
        "tenant-1",
        { from: 0, to: 1 },
      );
      for (const key of [
        "gen_ai.conversation.id",
        "langgraph.thread_id",
        "langwatch.thread_id",
      ]) {
        expect(CONVERSATION_ID_CLICKHOUSE_EXPRESSION).toContain(`'${key}'`);
      }
      expect(compiled?.sql).toContain(CONVERSATION_ID_CLICKHOUSE_EXPRESSION);
    });
  });
});

describe("given the user facet and the drawer header resolution", () => {
  describe("when the same attributes flow through both", () => {
    /** @scenario "User pill display and filter agree on one source" */
    it.each([
      [{ "langwatch.user_id": "u-1" }],
      [{}],
    ])("facet read and header userId agree for %j", (attributes) => {
      const facetValue = categoricalFacet("user").read!({
        summary: summaryWith(attributes),
      });
      const header = mapTraceSummaryToHeader(summaryWith(attributes));
      expect(facetValue).toBe(header.userId ?? "");
    });
  });
});

describe("given a trace whose conversation id rides langgraph.thread_id only", () => {
  describe("when the pill's filter token is evaluated", () => {
    /** @scenario "Conversation pill on a legacy-key trace filters to that conversation" */
    it("matches the legacy-key trace in memory and nothing else", () => {
      const legacyOnly = traceWith({ "langgraph.thread_id": "lg-6" });
      const canonicalOther = traceWith({ "gen_ai.conversation.id": "other" });
      const bare = traceWith({});

      expect(evaluateQueryInMemory('conversation:"lg-6"', legacyOnly)).toBe(
        true,
      );
      expect(evaluateQueryInMemory('conversation:"lg-6"', canonicalOther)).toBe(
        false,
      );
      expect(evaluateQueryInMemory('conversation:"lg-6"', bare)).toBe(false);
    });
  });

  describe("when the query asks whether a conversation exists", () => {
    /** @scenario "has:conversation counts a legacy-key trace as having a conversation" */
    it("has:conversation and none:conversation agree with their SQL predicate", () => {
      const compiled = translateFilterToClickHouse(
        "has:conversation",
        "tenant-1",
        { from: 0, to: 1 },
      );
      expect(compiled?.sql).toContain(CONVERSATION_ID_CLICKHOUSE_EXPRESSION);

      const legacyOnly = traceWith({ "langgraph.thread_id": "lg-7" });
      const canonical = traceWith({ "gen_ai.conversation.id": "c-7" });
      const bare = traceWith({});

      expect(evaluateQueryInMemory("has:conversation", legacyOnly)).toBe(true);
      expect(evaluateQueryInMemory("has:conversation", canonical)).toBe(true);
      expect(evaluateQueryInMemory("has:conversation", bare)).toBe(false);
      expect(evaluateQueryInMemory("none:conversation", bare)).toBe(true);
    });
  });
});

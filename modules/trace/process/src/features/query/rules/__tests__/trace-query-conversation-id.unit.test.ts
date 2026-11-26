/**
 * The Conversation pill, the conversation facet and `has:conversation` resolve one key chain,
 * so an id the pill shows is an id its filter can match.
 * @see modules/trace/specs/trace-conversation-id-resolution.feature
 */
import {
  deriveTraceConversationId,
  type InMemoryTrace,
  TRACE_CONVERSATION_ID_CLICKHOUSE_EXPRESSION,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { mapTraceSummaryToHeader } from "../../../../rules/trace-read-mappers.rules.ts";
import {
  traceQueryEvaluation,
  traceQueryTranslation,
} from "../../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { FACET_REGISTRY } from "../../../facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import type { ExpressionCategoricalDef } from "../../../facet/rules/trace-facet-registry.rules.ts";

function summaryWith(attributes: Record<string, string>): TraceSummaryData {
  const summary: Partial<TraceSummaryData> = {
    traceId: "trace_1",
    spanCount: 0,
    totalDurationMs: 0,
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    containsErrorStatus: false,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    rootSpanType: null,
    attributes,
    traceName: "",
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
  };
  return summary as TraceSummaryData;
}

function traceWith(attributes: Record<string, string>): InMemoryTrace {
  return { summary: summaryWith(attributes) };
}

function conversationFacet(): ExpressionCategoricalDef {
  const def = FACET_REGISTRY.find(
    (facet): facet is ExpressionCategoricalDef =>
      facet.key === "conversation" && facet.kind === "categorical" && "expression" in facet,
  );
  if (!def) throw new Error("the conversation facet is not an expression categorical");
  return def;
}

function compiledSql(queryText: string): string {
  const compiled = traceQueryTranslation.translateFilter({
    queryText,
    timeRange: { from: 0, to: 1 },
  });
  if (!compiled) throw new Error(`"${queryText}" compiled to no filter`);
  return compiled.sql;
}

describe("the conversation id a trace shows and filters by", () => {
  describe("given summaries carrying the id under each supported key layout", () => {
    /** @scenario "The pill and the conversation facet show the same id" */
    it.each([
      [{ "gen_ai.conversation.id": "c-1" }],
      [{ "langgraph.thread_id": "lg-3" }],
      [{ "langwatch.thread_id": "lw-3" }],
      [{ "gen_ai.conversation.id": "", "langgraph.thread_id": "lg-4" }],
      [{}],
    ])("the drawer header and the facet read agree for %j", (attributes) => {
      const expected = deriveTraceConversationId(attributes);
      const facetValue = conversationFacet().read?.({ summary: summaryWith(attributes) });
      const header = mapTraceSummaryToHeader(summaryWith(attributes));

      expect(facetValue).toBe(expected);
      expect(header.conversationId ?? "").toBe(expected);
    });

    /** @scenario "The pill and the conversation facet show the same id" */
    it("compiles conversation equality against the facet expression", () => {
      expect(conversationFacet().expression).toBe(TRACE_CONVERSATION_ID_CLICKHOUSE_EXPRESSION);
      expect(compiledSql('conversation:"lg-5"')).toContain(
        TRACE_CONVERSATION_ID_CLICKHOUSE_EXPRESSION,
      );
    });
  });

  describe("given a trace whose conversation id rides langgraph.thread_id only", () => {
    const legacyOnly = traceWith({ "langgraph.thread_id": "lg-6" });

    describe("when the pill's filter token is evaluated in memory", () => {
      /** @scenario "The pill's filter matches a trace keyed under langgraph.thread_id" */
      it("matches that trace and no other", () => {
        const query = 'conversation:"lg-6"';

        expect(traceQueryEvaluation.traceMatchesQuery(query, legacyOnly)).toBe(true);
        expect(
          traceQueryEvaluation.traceMatchesQuery(
            query,
            traceWith({ "gen_ai.conversation.id": "other" }),
          ),
        ).toBe(false);
        expect(traceQueryEvaluation.traceMatchesQuery(query, traceWith({}))).toBe(false);
      });
    });

    describe("when the query asks whether a conversation exists", () => {
      /** @scenario "has:conversation counts a legacy-key trace as having a conversation" */
      it("has: and none: agree with each other and with the SQL predicate on every layout", () => {
        const canonical = traceWith({ "gen_ai.conversation.id": "c-7" });
        const bare = traceWith({});
        const matches = (query: string, trace: InMemoryTrace) =>
          traceQueryEvaluation.traceMatchesQuery(query, trace);

        expect(compiledSql("has:conversation")).toContain(
          TRACE_CONVERSATION_ID_CLICKHOUSE_EXPRESSION,
        );
        expect(matches("has:conversation", legacyOnly)).toBe(true);
        expect(matches("none:conversation", legacyOnly)).toBe(false);
        expect(matches("has:conversation", canonical)).toBe(true);
        expect(matches("none:conversation", canonical)).toBe(false);
        expect(matches("has:conversation", bare)).toBe(false);
        expect(matches("none:conversation", bare)).toBe(true);
      });
    });
  });
});

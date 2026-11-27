/** @see modules/trace/specs/trace-conversation-id-resolution.feature */
import { describe, expect, it } from "vitest";

import {
  deriveTraceConversationId,
  TRACE_CONVERSATION_ID_CLICKHOUSE_EXPRESSION,
} from "../trace-summary-attribute-values.ts";

describe("deriveTraceConversationId", () => {
  describe("given attributes carrying the id under different keys", () => {
    /** @scenario "The conversation id follows the key chain" */
    it.each([
      [{ "gen_ai.conversation.id": "canonical", "langgraph.thread_id": "legacy" }, "canonical"],
      [{ "langgraph.thread_id": "lg-1", "langwatch.thread_id": "lw-1" }, "lg-1"],
      [{ "langwatch.thread_id": "lw-1" }, "lw-1"],
      [{ "gen_ai.conversation.id": "", "langgraph.thread_id": "lg-2" }, "lg-2"],
      [{}, ""],
    ])("resolves %j to %j", (attributes, expected) => {
      expect(deriveTraceConversationId(attributes)).toBe(expected);
    });

    it("resolves missing attributes to an empty id", () => {
      expect(deriveTraceConversationId(void 0)).toBe("");
    });
  });

  describe("given the ClickHouse expression", () => {
    it("coalesces every key in chain order, skipping empty values", () => {
      expect(TRACE_CONVERSATION_ID_CLICKHOUSE_EXPRESSION).toBe(
        "coalesce(nullIf(Attributes['gen_ai.conversation.id'], ''), " +
          "nullIf(Attributes['langgraph.thread_id'], ''), " +
          "nullIf(Attributes['langwatch.thread_id'], ''), '')",
      );
    });
  });
});

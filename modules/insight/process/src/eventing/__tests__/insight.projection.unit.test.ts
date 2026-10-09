/**
 * @vitest-environment node
 * A filed event as the first release stored it, read and folded by today's schema.
 * @see modules/insight/specs/insight-inbox.feature
 */

import {
  INSIGHT_AGGREGATE_TYPE,
  INSIGHT_EVENT_TYPES,
  INSIGHT_EVENT_VERSIONS,
} from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import { InsightMemoryStore } from "../../repositories/memory/insight-memory.store.ts";
import { MemoryInsightProjectionRepository } from "../../repositories/memory/memory.insight-projection.repository.ts";
import { InsightFiledEventSchema } from "../insight.events.ts";
import { applyInsightEvent, createInsightProjection } from "../insight.projection.ts";

const FILED_AT = Date.UTC(2026, 9, 9, 7);

/** The whole stored event of the first release: no `board`, no `filedVia`, no `replay`. */
const STORED_BEFORE_POINTERS = {
  id: "event-1",
  aggregateId: "insight-1",
  aggregateType: INSIGHT_AGGREGATE_TYPE,
  tenantId: "project-1",
  createdAt: FILED_AT,
  occurredAt: FILED_AT,
  type: INSIGHT_EVENT_TYPES.FILED,
  version: INSIGHT_EVENT_VERSIONS.FILED,
  data: {
    insightId: "insight-1",
    title: "Checkout errors doubled",
    body: "Checkout errors doubled overnight.",
    tone: "bad",
    topic: null,
    validDays: 7,
    lwql: "SELECT count() FROM traces",
    source: { conversationId: "conversation-1", messageId: "message-1" },
    filedByUserId: "user-filer",
  },
};

describe("given a filed event stored without a board, a kind or a window", () => {
  describe("when the event is folded", () => {
    /** @scenario "An insight filed before pointers existed still reads" */
    it("gives an insight with no pointer and no window, filed from a chat", () => {
      const projection = createInsightProjection({
        store: MemoryInsightProjectionRepository.create({ rows: InsightMemoryStore.create() }),
      });

      const state = applyInsightEvent(
        projection.init(),
        InsightFiledEventSchema.parse(STORED_BEFORE_POINTERS),
      );

      expect(state).toEqual({
        title: "Checkout errors doubled",
        body: "Checkout errors doubled overnight.",
        tone: "bad",
        topic: null,
        validDays: 7,
        lwql: "SELECT count() FROM traces",
        replay: null,
        source: { conversationId: "conversation-1", messageId: "message-1" },
        board: null,
        filedVia: "chat",
        filedByUserId: "user-filer",
        filedAt: FILED_AT,
        renewedAt: null,
      });
    });
  });
});

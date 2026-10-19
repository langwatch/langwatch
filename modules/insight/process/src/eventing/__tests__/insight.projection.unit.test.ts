/**
 * @vitest-environment node
 * A filed event as the first release stored it, read and folded by today's schema, whose
 * insight a filed event makes it, and what a later run's renewal changes on it.
 * @see modules/insight/specs/insight-inbox.feature
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  INSIGHT_AGGREGATE_TYPE,
  INSIGHT_EVENT_TYPES,
  INSIGHT_EVENT_VERSIONS,
} from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import { InsightMemoryStore } from "../../repositories/memory/insight-memory.store.ts";
import { MemoryInsightProjectionRepository } from "../../repositories/memory/memory.insight-projection.repository.ts";
import { applyInsightReaderEvent } from "../insight-reader.projection.ts";
import { InsightFiledEventSchema, InsightRenewedEventSchema } from "../insight.events.ts";
import { applyInsightEvent, createInsightProjection } from "../insight.projection.ts";

const FILED_AT = Date.UTC(2026, 9, 9, 7);
const DAY_MS = 86_400_000;
const PROJECTION = createInsightProjection({
  store: MemoryInsightProjectionRepository.create({ rows: InsightMemoryStore.create() }),
});
const INITIAL = PROJECTION.init();

/** The whole stored event of the first release: no `board`, `filedVia`, `replay` or owner. */
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
      const state = applyInsightEvent(
        INITIAL,
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
        ownerUserId: "user-filer",
        filedByUserId: "user-filer",
        findingKey: null,
        filedAt: FILED_AT,
        renewedAt: null,
      });
    });

    /** @scenario "An insight filed before keys existed still folds" */
    it("gives an insight that holds no key", () => {
      const stored = InsightFiledEventSchema.parse(STORED_BEFORE_POINTERS);

      expect(stored.data.findingKey).toBeNull();
      expect(applyInsightEvent(INITIAL, stored).findingKey).toBeNull();
    });

    /** @scenario "An insight filed before owners existed belongs to whoever filed it" */
    it("gives the insight to the person who filed it", () => {
      const stored = InsightFiledEventSchema.parse(STORED_BEFORE_POINTERS);

      expect(stored.data.ownerUserId).toBeNull();
      expect(applyInsightEvent(INITIAL, stored).ownerUserId).toBe("user-filer");
    });
  });
});

describe("given a filed event that names an owner", () => {
  describe("when the event is folded", () => {
    it("gives the insight to the named owner, whoever filed it", () => {
      const filedForAnother = InsightFiledEventSchema.parse({
        ...STORED_BEFORE_POINTERS,
        data: { ...STORED_BEFORE_POINTERS.data, ownerUserId: "user-owner" },
      });
      const filedByRun = InsightFiledEventSchema.parse({
        ...STORED_BEFORE_POINTERS,
        data: {
          ...STORED_BEFORE_POINTERS.data,
          filedVia: "run",
          ownerUserId: "user-owner",
          filedByUserId: null,
        },
      });

      expect(applyInsightEvent(INITIAL, filedForAnother).ownerUserId).toBe("user-owner");
      expect(applyInsightEvent(INITIAL, filedByRun)).toMatchObject({
        ownerUserId: "user-owner",
        filedByUserId: null,
        filedVia: "run",
      });
    });
  });
});

describe("given an insight a run filed with a key and a query", () => {
  const WINDOW = { granularitySeconds: 3_600, period: null, parameters: {} };
  const filedByRun = InsightFiledEventSchema.parse({
    ...STORED_BEFORE_POINTERS,
    data: {
      ...STORED_BEFORE_POINTERS.data,
      replay: { start: FILED_AT - DAY_MS, end: FILED_AT, ...WINDOW },
      board: { id: "dashboard-1", name: "Checkout health", widget: null },
      filedVia: "run",
      ownerUserId: "user-owner",
      filedByUserId: null,
      findingKey: "checkout-errors-doubled",
    },
  });

  /** A renewal of that insight by the run of `days` days later, stored before tones renewed. */
  const renewedAfter = (days: number, body = "Checkout errors are still twice the usual.") =>
    InsightRenewedEventSchema.parse({
      ...STORED_BEFORE_POINTERS,
      id: `event-renewed-${days}`,
      createdAt: FILED_AT + days * DAY_MS,
      occurredAt: FILED_AT + days * DAY_MS,
      type: INSIGHT_EVENT_TYPES.RENEWED,
      version: INSIGHT_EVENT_VERSIONS.RENEWED,
      data: {
        insightId: "insight-1",
        body,
        validDays: 3,
        replay: { start: FILED_AT + (days - 1) * DAY_MS, end: FILED_AT + days * DAY_MS, ...WINDOW },
        source: { conversationId: `conversation-${days}`, messageId: `message-${days}` },
      },
    });

  const filed = applyInsightEvent(INITIAL, filedByRun);

  describe("when a later run renews it", () => {
    /** @scenario "A renewed insight keeps its id and reads as seen again" */
    it("is the same insight with the renewal's words, tone, validity, window and source", () => {
      const stored = renewedAfter(1);
      const renewal = { ...stored, data: { ...stored.data, tone: "good" as const } };

      expect(PROJECTION.eventTypes).toContain(INSIGHT_EVENT_TYPES.RENEWED);
      expect(PROJECTION.key?.(renewal)).toBe("insight-1");
      expect(applyInsightEvent(filed, renewal)).toEqual({
        ...filed,
        body: "Checkout errors are still twice the usual.",
        tone: "good",
        validDays: 3,
        replay: { start: FILED_AT, end: FILED_AT + DAY_MS, ...WINDOW },
        source: { conversationId: "conversation-1", messageId: "message-1" },
        renewedAt: FILED_AT + DAY_MS,
      });
    });

    /** @scenario "A renewal stored before tones were renewed keeps the insight's tone" */
    it("keeps the tone the insight was filed with", () => {
      const renewal = renewedAfter(1);

      expect(renewal.data.tone).toBeNull();
      expect(applyInsightEvent(filed, renewal).tone).toBe("bad");
    });

    it("keeps the source it holds when a board check's renewal names none", () => {
      const withSource = applyInsightEvent(filed, renewedAfter(1));
      const stored = renewedAfter(2);
      const renewal = InsightRenewedEventSchema.parse({
        ...stored,
        data: { ...stored.data, source: null },
      });

      expect(applyInsightEvent(withSource, renewal).source).toEqual({
        conversationId: "conversation-1",
        messageId: "message-1",
      });
    });

    /** @scenario "Renewal changes nothing the person did with the insight" */
    it("leaves a reader's seen, done and kept state as it was", () => {
      const reader = { seenAt: FILED_AT + 1, archivedAt: null, keptAt: FILED_AT + 2 };

      expect(applyInsightReaderEvent(reader, renewedAfter(1))).toBe(reader);
    });
  });

  describe("when a renewal stamped before the one on the row is folded", () => {
    /** @scenario "A late repeat of an older renewal changes nothing" */
    it("keeps the row as the later renewal left it, and takes the same renewal twice", () => {
      const renewed = applyInsightEvent(filed, renewedAfter(2));

      expect(applyInsightEvent(renewed, renewedAfter(1, "An older run's words."))).toBe(renewed);
      expect(applyInsightEvent(renewed, renewedAfter(2))).toEqual(renewed);
    });
  });
});

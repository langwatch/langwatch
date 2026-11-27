import { describe, expect, it } from "vitest";

import type { Event } from "../../domain/types.ts";
import {
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import { compareEventLogPageOrder, eventLogPageCursorAfter } from "../event-log-page-order.ts";

const tenantId = createTestTenantId();

function ev(id: string, createdAt: number, idempotencyKey?: string): Event {
  const base = createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    TEST_CONSTANTS.AGGREGATE_TYPE,
    tenantId,
    undefined,
    createdAt,
    undefined,
    {},
    id,
  );
  return idempotencyKey === undefined ? base : { ...base, idempotencyKey };
}

describe("event log page order", () => {
  describe("given events whose keys run against their arrival", () => {
    it("orders by key first, then arrival, then id", () => {
      const events = [ev("b", 1, "k2"), ev("c", 2, "k1"), ev("a", 2, "k1"), ev("d", 0, "k1")];

      expect(events.toSorted(compareEventLogPageOrder).map((e) => e.id)).toEqual([
        "d",
        "a",
        "c",
        "b",
      ]);
    });

    it("sorts an event stored without a key first, as event_log holds it as empty", () => {
      expect([ev("keyed", 1, "k"), ev("bare", 2)].toSorted(compareEventLogPageOrder)[0]!.id).toBe(
        "bare",
      );
    });
  });

  describe("given keys whose UTF-16 order differs from their byte order", () => {
    it("orders them as ClickHouse compares bytes: U+E000 before a supplementary character", () => {
      const events = [ev("astral", 1, "\u{10000}"), ev("private-use", 2, "\uE000")];

      expect(events.toSorted(compareEventLogPageOrder).map((e) => e.id)).toEqual([
        "private-use",
        "astral",
      ]);
    });
  });

  describe("given equal keys and times whose ids differ in UTF-16 and byte order", () => {
    it("breaks the tie by id in byte order too", () => {
      const events = [ev("\u{10000}", 1, "k"), ev("\uE000", 1, "k")];

      expect(events.toSorted(compareEventLogPageOrder).map((e) => e.id)).toEqual([
        "\uE000",
        "\u{10000}",
      ]);
    });
  });

  describe("given a page a store handed back in arrival order", () => {
    it("resumes after its furthest event in page order, not its last element", () => {
      const page = [ev("e4", 4, "k1"), ev("e5", 5, "k0")];

      expect(eventLogPageCursorAfter(page)).toEqual({
        idempotencyKey: "k1",
        timestamp: 4,
        eventId: "e4",
      });
    });
  });

  describe("given an empty page", () => {
    it("has no cursor", () => {
      expect(eventLogPageCursorAfter([])).toBeUndefined();
    });
  });
});

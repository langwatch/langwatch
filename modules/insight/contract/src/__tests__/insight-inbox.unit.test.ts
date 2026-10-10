/**
 * The folder rules the page, the bell and the sidebar count share: a folder is derived for
 * one reader at read time, never stored.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { describe, expect, it } from "vitest";

import { deriveInsightInbox, INSIGHT_FOLDERS, type InsightFolder } from "../insight-inbox.ts";
import type { InsightEntry } from "../insight.ts";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 9, 7);

function daysAgo(days: number): number {
  return NOW - days * DAY_MS;
}

/** An unseen insight filed today that stays true for 7 days; a test overrides what it is about. */
function entry(overrides: Partial<InsightEntry> = {}): InsightEntry {
  return {
    id: "insight-1",
    title: "Checkout errors doubled",
    body: "Checkout errors doubled overnight.",
    tone: "bad",
    topic: null,
    validDays: 7,
    lwql: null,
    replay: null,
    source: null,
    board: null,
    filedVia: "chat",
    ownerUserId: "user-filer",
    filedByUserId: "user-filer",
    filedAt: NOW,
    renewedAt: null,
    seenAt: null,
    archivedAt: null,
    keptAt: null,
    ...overrides,
  };
}

/** Every folder the reader finds the insight in when they open Insights. */
function foldersHolding(insight: InsightEntry): InsightFolder[] {
  const inbox = deriveInsightInbox({ entries: [insight], now: NOW });
  return INSIGHT_FOLDERS.filter((folder) => inbox[folder].some((shown) => shown.id === insight.id));
}

describe("given an insight that stays true for 7 days", () => {
  describe("when the reader opens Insights 2 days after it was filed", () => {
    /** @scenario "A fresh insight is in the inbox" */
    it("is in the Inbox folder", () => {
      expect(foldersHolding(entry({ filedAt: daysAgo(2) }))).toEqual(["inbox"]);
    });
  });

  describe("when the reader opens Insights 8 days after it was filed", () => {
    /** @scenario "An insight past its validity is stale" */
    it("is in the Stale folder", () => {
      expect(foldersHolding(entry({ filedAt: daysAgo(8) }))).toEqual(["stale"]);
    });

    /** @scenario "A kept insight stays in the inbox after its validity ends" */
    it("is in the Inbox folder once the reader kept it", () => {
      expect(foldersHolding(entry({ filedAt: daysAgo(8), keptAt: daysAgo(1) }))).toEqual(["inbox"]);
    });
  });
});

describe("given an insight the reader marked done", () => {
  describe("when the reader opens Insights", () => {
    /** @scenario "A done insight is archived" */
    it("is in the Archived folder", () => {
      expect(foldersHolding(entry({ archivedAt: daysAgo(1) }))).toEqual(["archived"]);
    });
  });
});

describe("given 3 unseen insights in the inbox and 1 unseen stale insight", () => {
  describe("when the badge is derived", () => {
    /** @scenario "The badge counts unseen insights in the inbox only" */
    it("counts 3", () => {
      const entries = [
        entry({ id: "insight-1" }),
        entry({ id: "insight-2" }),
        entry({ id: "insight-3" }),
        entry({ id: "insight-stale", filedAt: daysAgo(8) }),
      ];

      const inbox = deriveInsightInbox({ entries, now: NOW });

      expect(inbox.stale.map((shown) => shown.id)).toEqual(["insight-stale"]);
      expect(inbox.count).toBe(3);
    });
  });
});

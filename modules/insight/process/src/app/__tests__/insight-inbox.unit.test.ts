/**
 * @vitest-environment node
 * The inbox as its owner finds it, and as nobody else does: the installed module's writes,
 * folded by its own pipeline and read back through the folder rules the page, the bell and the
 * sidebar share.
 * @see modules/insight/specs/insight-inbox.feature
 */

import {
  deriveInsightInbox,
  INSIGHT_EVENT_TYPES,
  type InsightFolder,
  insightFolder,
} from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { filing, installInsight, type InstalledInsight, PROJECT } from "./insight.fixture.ts";

const FILER = "user-filer";
const OTHER = "user-other";

let installed: InstalledInsight;

beforeEach(async () => {
  installed = await installInsight();
});

afterEach(async () => {
  await installed.stop();
});

async function inboxOf(userId: string) {
  const entries = await installed.app.findInsights({ projectId: PROJECT, userId });
  return deriveInsightInbox({ entries, now: nowInstant().epochMilliseconds });
}

async function folderFor({
  userId,
  insightId,
}: {
  userId: string;
  insightId: string;
}): Promise<InsightFolder> {
  const entries = await installed.app.findInsights({ projectId: PROJECT, userId });
  const entry = entries.find((candidate) => candidate.id === insightId);
  if (!entry) throw new Error(`${userId} has no insight ${insightId}`);
  return insightFolder({ entry, now: nowInstant().epochMilliseconds });
}

describe("given a member files an insight", () => {
  describe("when they read their inbox", () => {
    /** @scenario "The member who files an insight has already seen it" */
    it("holds the insight, which does not count as unseen for them", async () => {
      const filed = await installed.app.fileInsight({ ...filing(), userId: FILER });

      const inbox = await inboxOf(FILER);

      expect(inbox.inbox.map((entry) => entry.id)).toEqual([filed.id]);
      expect(inbox.count).toBe(0);
    });
  });
});

describe("given a run files an insight for a member, with no person who saved it", () => {
  describe("when the project's members read their inboxes", () => {
    /** @scenario "An insight a run files for a person belongs to that person" */
    it("shows it unseen to the member it was filed for, and to nobody else", async () => {
      const insightId = await installed.fileByRun({ ownerUserId: OTHER });

      const owned = await inboxOf(OTHER);

      expect(owned.unseen).toEqual([
        expect.objectContaining({
          id: insightId,
          ownerUserId: OTHER,
          filedByUserId: null,
          filedVia: "run",
        }),
      ]);
      for (const userId of [FILER, "user-another"]) {
        await expect(installed.app.findInsights({ projectId: PROJECT, userId })).resolves.toEqual(
          [],
        );
      }
    });
  });
});

const BOARD = {
  id: "dashboard-1",
  name: "Checkout health",
  widget: { id: "widget-1", name: "Errors by day" },
};
const REPLAY = {
  start: Date.UTC(2026, 6, 5),
  end: Date.UTC(2026, 7, 4),
  granularitySeconds: 86_400,
  period: "Last 30 days",
  parameters: { model: "gpt-5", minimum: 5, includeRetries: false },
};
const QUERY = "SELECT count() FROM traces WHERE model = {model:String}";

describe("given a member saves a Langy answer that was about a widget on a board", () => {
  describe("when the insight is filed", () => {
    /** @scenario "An insight filed from a board keeps a pointer to the board and the widget" */
    it("keeps the board and the widget, ids and names, in its owner's inbox", async () => {
      const filed = await installed.app.fileInsight({ ...filing({ board: BOARD }), userId: FILER });

      const [entry] = await installed.app.findInsights({ projectId: PROJECT, userId: FILER });

      expect(filed.board).toEqual(BOARD);
      expect(entry?.board).toEqual(BOARD);
    });
  });
});

describe("given a member files an insight away from any board", () => {
  describe("when they read their inbox", () => {
    /** @scenario "A member's filing is recorded as saved from a chat" */
    it("records it as filed from a chat, with no pointer and no window", async () => {
      const filed = await installed.app.fileInsight({ ...filing(), userId: FILER });

      const [entry] = await installed.app.findInsights({ projectId: PROJECT, userId: FILER });

      expect(filed).toMatchObject({ filedVia: "chat", board: null, replay: null });
      expect(entry).toMatchObject({ filedVia: "chat", board: null, replay: null });
    });
  });
});

describe("given a member files an insight with a query, a window and parameter values", () => {
  describe("when they read their inbox", () => {
    /** @scenario "An insight keeps its query, the fixed window and the values it was filed with" */
    it("carries that query, that window and those values unchanged", async () => {
      await installed.app.fileInsight({
        ...filing({ lwql: QUERY, replay: REPLAY }),
        userId: FILER,
      });

      const [entry] = await installed.app.findInsights({ projectId: PROJECT, userId: FILER });

      expect(entry?.lwql).toBe(QUERY);
      expect(entry?.replay).toEqual(REPLAY);
    });
  });
});

describe("given an insight the reader marked done", () => {
  describe("when the reader keeps it", () => {
    /** @scenario "Keeping an archived insight brings it back to the inbox" */
    it("moves it from Archived back to the Inbox folder", async () => {
      const { id: insightId } = await installed.app.fileInsight({ ...filing(), userId: FILER });
      const scope = { projectId: PROJECT, insightId, userId: FILER };
      await installed.app.archiveInsight(scope);
      expect(await folderFor(scope)).toBe("archived");

      await installed.app.keepInsight(scope);

      expect(await folderFor(scope)).toBe("inbox");
    });
  });
});

describe("given 2 unseen insights in the inbox", () => {
  describe("when the reader opens the Inbox folder, twice", () => {
    /** @scenario "Opening a folder marks what it shows as seen, once" */
    it("marks both seen on the first visit and sends no seen event on the second", async () => {
      // A run's filings: the owner did not save them, so they have not seen them.
      const first = await installed.fileByRun({ ownerUserId: FILER });
      const second = await installed.fileByRun({ ownerUserId: FILER });
      const shown = (await inboxOf(FILER)).inbox.map((entry) => entry.id);
      expect((await inboxOf(FILER)).count).toBe(2);
      const visit = { projectId: PROJECT, userId: FILER, insightIds: shown };

      await installed.app.markInsightsSeen(visit);

      const afterFirstVisit = await inboxOf(FILER);
      expect(afterFirstVisit.unseen).toEqual([]);
      expect(afterFirstVisit.inbox.map((entry) => entry.seenAt)).not.toContain(null);

      await installed.app.markInsightsSeen(visit);

      // Each stream holds the filing and the one seen its owner's first visit sent.
      for (const insightId of [first, second]) {
        expect(await installed.eventTypesOf({ projectId: PROJECT, insightId })).toEqual([
          INSIGHT_EVENT_TYPES.FILED,
          INSIGHT_EVENT_TYPES.SEEN,
        ]);
      }
    });
  });
});

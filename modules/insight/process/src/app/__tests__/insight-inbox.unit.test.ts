/**
 * @vitest-environment node
 * The inbox as each reader finds it: the installed module's writes, folded by its own pipeline
 * and read back through the folder rules the page, the bell and the sidebar share.
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
const READER = "user-reader";

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
  describe("when the project's members read their inboxes", () => {
    /** @scenario "The member who files an insight has already seen it" */
    it("counts it as unseen for every member but the one who filed it", async () => {
      await installed.app.fileInsight({ ...filing(), userId: FILER });

      expect((await inboxOf(FILER)).count).toBe(0);
      expect((await inboxOf(READER)).count).toBe(1);
      expect((await inboxOf("user-another")).count).toBe(1);
    });
  });
});

describe("given an insight the reader marked done", () => {
  describe("when the reader keeps it", () => {
    /** @scenario "Keeping an archived insight brings it back to the inbox" */
    it("moves it from Archived back to the Inbox folder", async () => {
      const { id: insightId } = await installed.app.fileInsight({ ...filing(), userId: FILER });
      const scope = { projectId: PROJECT, insightId, userId: READER };
      await installed.app.archiveInsight(scope);
      expect(await folderFor(scope)).toBe("archived");

      await installed.app.keepInsight(scope);

      expect(await folderFor(scope)).toBe("inbox");
    });
  });
});

describe("given two members of the project and one insight", () => {
  describe("when the first member marks it done", () => {
    /** @scenario "One member marking an insight done does not move it for another" */
    it("archives it for the first member and leaves it in the second member's inbox", async () => {
      const { id: insightId } = await installed.app.fileInsight({ ...filing(), userId: FILER });

      await installed.app.archiveInsight({ projectId: PROJECT, insightId, userId: READER });

      expect(await folderFor({ userId: READER, insightId })).toBe("archived");
      expect(await folderFor({ userId: "user-second", insightId })).toBe("inbox");
    });
  });
});

describe("given 2 unseen insights in the inbox", () => {
  describe("when the reader opens the Inbox folder, twice", () => {
    /** @scenario "Opening a folder marks what it shows as seen, once" */
    it("marks both seen on the first visit and sends no seen event on the second", async () => {
      const first = await installed.app.fileInsight({ ...filing(), userId: FILER });
      const second = await installed.app.fileInsight({ ...filing(), userId: FILER });
      const shown = (await inboxOf(READER)).inbox.map((entry) => entry.id);
      expect((await inboxOf(READER)).count).toBe(2);
      const visit = { projectId: PROJECT, userId: READER, insightIds: shown };

      await installed.app.markInsightsSeen(visit);

      const afterFirstVisit = await inboxOf(READER);
      expect(afterFirstVisit.unseen).toEqual([]);
      expect(afterFirstVisit.inbox.map((entry) => entry.seenAt)).not.toContain(null);

      await installed.app.markInsightsSeen(visit);

      // Each stream holds the filing, the filer's own seen, and one seen for this reader.
      for (const { id: insightId } of [first, second]) {
        expect(await installed.eventTypesOf({ projectId: PROJECT, insightId })).toEqual([
          INSIGHT_EVENT_TYPES.FILED,
          INSIGHT_EVENT_TYPES.SEEN,
          INSIGHT_EVENT_TYPES.SEEN,
        ]);
      }
    });
  });
});

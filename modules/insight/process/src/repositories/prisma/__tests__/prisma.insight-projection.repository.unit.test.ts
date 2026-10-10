/**
 * @vitest-environment node
 * The insight row as Postgres holds it: what the fold writes for a pointer and a window,
 * and how a row written before those columns existed reads.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { StoredProjection } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import type { InsightState } from "../../../eventing/insight.projection.ts";
import { PrismaInsightProjectionRepository } from "../prisma.insight-projection.repository.ts";
import { type InsightRow, insightEntryFromRows } from "../prisma.insight.mapper.ts";

const FILED_AT = Date.UTC(2026, 9, 9, 7);
const CONTEXT = {
  tenantId: createTenantId("project-1"),
  aggregateId: "insight-1",
  key: "insight-1",
};
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
  parameters: { model: "gpt-5", minimum: 5 },
};

/** What the additive migrations leave on a row folded before them: NULLs and the `chat` default. */
const ROW_BEFORE_COLUMNS: InsightRow = {
  id: "insight-1",
  projectId: "project-1",
  title: "Checkout errors doubled",
  body: "Checkout errors doubled overnight.",
  tone: "bad",
  topic: null,
  validDays: 7,
  lwql: "SELECT count() FROM traces",
  sourceConversationId: null,
  sourceMessageId: null,
  filedByUserId: "user-filer",
  filedAt: FILED_AT,
  renewedAt: null,
  createdAt: FILED_AT,
  updatedAt: FILED_AT,
  occurredAt: FILED_AT,
  acceptedAt: FILED_AT,
  lastEventId: "event-1",
  projectionVersion: "2026-10-09",
  boardId: null,
  boardName: null,
  widgetId: null,
  widgetName: null,
  filedVia: "chat",
  replayStart: null,
  replayEnd: null,
  replayGranularitySeconds: null,
  replayContext: null,
  ownerUserId: null,
};

function folded(state: Partial<InsightState> = {}): StoredProjection<InsightState> {
  return {
    state: {
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
      filedAt: FILED_AT,
      renewedAt: null,
      ...state,
    },
    cursor: { acceptedAt: FILED_AT, eventId: "event-1" },
    occurredAt: FILED_AT,
    createdAt: FILED_AT,
    updatedAt: FILED_AT,
    version: "2026-10-09",
  };
}

/** A repository over one remembered row: an upsert writes it, a read answers it. */
function repositoryOverOneRow() {
  const written: { row?: Record<string, unknown> } = {};
  const repository = PrismaInsightProjectionRepository.create({
    prisma: prismaDouble({
      insightProjection: {
        upsert: ({ create }: { create: Record<string, unknown> }) => {
          written.row = create;
          return Promise.resolve(create);
        },
        // What Postgres answers for a column written as SQL NULL.
        findFirst: () =>
          Promise.resolve(
            written.row && {
              ...written.row,
              replayContext:
                written.row.replayContext === Prisma.DbNull ? null : written.row.replayContext,
            },
          ),
      },
    }),
  });
  return { repository, written };
}

describe("given an insight that came from a widget on a board", () => {
  describe("when its row is written", () => {
    /** @scenario "The pointer is stored as plain ids and names" */
    it("holds the board and the widget as ids and names, and reads back the same", async () => {
      const { repository, written } = repositoryOverOneRow();

      await repository.store(folded({ board: BOARD }), CONTEXT);

      expect(written.row).toMatchObject({
        boardId: "dashboard-1",
        boardName: "Checkout health",
        widgetId: "widget-1",
        widgetName: "Errors by day",
        filedVia: "chat",
      });
      const read = await repository.get("insight-1", CONTEXT);
      expect(read.kind === "folded" && read.projection.state.board).toEqual(BOARD);
    });
  });
});

describe("given an insight with a query, a window and parameter values", () => {
  describe("when its row is written", () => {
    /** @scenario "The window is stored beside the values in force" */
    it("holds the window as columns and the values as one map, and reads back the same", async () => {
      const { repository, written } = repositoryOverOneRow();

      await repository.store(folded({ lwql: "SELECT 1", replay: REPLAY }), CONTEXT);

      expect(written.row).toMatchObject({
        replayStart: REPLAY.start,
        replayEnd: REPLAY.end,
        replayGranularitySeconds: 86_400,
        replayContext: { period: "Last 30 days", parameters: { model: "gpt-5", minimum: 5 } },
      });
      const read = await repository.get("insight-1", CONTEXT);
      expect(read.kind === "folded" && read.projection.state.replay).toEqual(REPLAY);
    });
  });

  describe("when an insight without a window is written", () => {
    it("writes SQL NULL for the values, so the row reads back with no window", async () => {
      const { repository, written } = repositoryOverOneRow();

      await repository.store(folded(), CONTEXT);

      expect(written.row?.replayContext).toBe(Prisma.DbNull);
      const read = await repository.get("insight-1", CONTEXT);
      expect(read.kind === "folded" && read.projection.state.replay).toBeNull();
    });
  });
});

describe("given an insight a run filed for a person", () => {
  describe("when its row is written", () => {
    it("holds the owner in a column of its own, beside nobody who filed it", async () => {
      const { repository, written } = repositoryOverOneRow();

      await repository.store(
        folded({ filedVia: "run", ownerUserId: "user-owner", filedByUserId: null }),
        CONTEXT,
      );

      expect(written.row).toMatchObject({ ownerUserId: "user-owner", filedByUserId: null });
      const read = await repository.get("insight-1", CONTEXT);
      expect(read.kind === "folded" && read.projection.state.ownerUserId).toBe("user-owner");
    });
  });
});

describe("given an insight row written before the pointer, window and owner columns existed", () => {
  describe("when the row is read", () => {
    /** @scenario "An insight stored before owners existed belongs to whoever filed it" */
    it("gives the insight to the person who filed it", () => {
      expect(
        insightEntryFromRows({ insight: ROW_BEFORE_COLUMNS, reader: undefined }),
      ).toMatchObject({ ownerUserId: "user-filer", filedByUserId: "user-filer" });
    });

    /** @scenario "An insight stored before pointers existed still reads" */
    it("gives an insight with no pointer and no window, filed from a chat", () => {
      expect(
        insightEntryFromRows({ insight: ROW_BEFORE_COLUMNS, reader: undefined }),
      ).toMatchObject({
        lwql: "SELECT count() FROM traces",
        board: null,
        replay: null,
        filedVia: "chat",
      });
    });
  });
});

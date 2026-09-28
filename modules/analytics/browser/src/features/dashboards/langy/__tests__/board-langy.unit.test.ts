/**
 * What a board hands Langy, as text the agent reads: the board it is asked
 * from, and a block's own result for the insights it quotes.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  blockInsightsRequest,
  blockResultDigest,
  boardQuestion,
  FLIGHT_DECK_SUBJECT,
} from "../model/board-langy.ts";

const PERIOD = {
  periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
  periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
  granularitySeconds: 86_400,
};

describe("the context a board hands Langy", () => {
  describe("given a question asked on the Agent Flight Deck", () => {
    /** @scenario "AC16 Ask Langy from the board" */
    it("trims the question and names the deck, its panels, its period and that it is read-only", () => {
      const request = boardQuestion({
        question: "  Why did errors spike?  ",
        board: FLIGHT_DECK_SUBJECT,
        period: PERIOD,
      });

      expect(request.question).toBe("Why did errors spike?");
      const [board] = request.context;
      expect(board?.label).toBe("Agent Flight Deck");
      expect(board?.ref).toContain("read-only");
      expect(board?.ref).toContain("Most impactful traces");
      expect(board?.ref).toContain("2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z");
    });
  });
});

describe("the insights request for one block", () => {
  describe("given a block whose query returned numbers", () => {
    const rows = {
      main: [
        { bucket: "2026-09-01", traces: 7 },
        { bucket: "2026-09-02", traces: 12 },
      ],
    };

    /** @scenario "AC17 Langy insights on a block quote the block's own result" */
    it("carries every number of that block's own result", () => {
      expect(blockResultDigest(rows)).toBe(
        "main: bucket=2026-09-01, traces=7 | bucket=2026-09-02, traces=12",
      );
    });

    /** @scenario "AC17 Langy insights on a block quote the block's own result" */
    it("asks for insights on that block with its result attached", () => {
      const request = blockInsightsRequest({
        boardName: "Weekly review",
        block: { title: "Trace count over time", subtitle: "How many traces arrived" },
        rows,
        period: PERIOD,
      });

      expect(request.question).toContain('"Trace count over time"');
      expect(request.context).toEqual([
        {
          kind: "dashboard",
          label: "Trace count over time",
          ref: expect.stringContaining("traces=12"),
        },
      ]);
    });
  });

  describe("given a statement with no rows", () => {
    /** @scenario "AC17 Langy insights on a block quote the block's own result" */
    it("says so instead of handing over an empty list", () => {
      expect(blockResultDigest({ main: [] })).toBe("main: no rows");
    });
  });
});

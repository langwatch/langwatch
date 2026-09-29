/**
 * What a board hands Langy, as text the agent reads: the open board, the
 * widgets on it and the period it reads over.
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { boardQuestion, boardSubject } from "../model/board-langy.ts";

const PERIOD = {
  periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
  periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
  granularitySeconds: 86_400 as const,
};

describe("the context a board hands Langy", () => {
  describe("given a question asked on a board made from the Agent Flight Deck template", () => {
    /** @scenario "AC16 Ask Langy from the board" */
    it("trims the question and names the open board, its widgets and its period", () => {
      const request = boardQuestion({
        question: "  Why did errors spike?  ",
        board: boardSubject({
          board: { id: "board-9", name: "Agent Flight Deck 2" },
          widgets: [{ name: "Status" }, { name: "Most impactful traces" }],
        }),
        period: PERIOD,
      });

      expect(request.question).toBe("Why did errors spike?");
      const [board] = request.context;
      expect(board?.label).toBe("Agent Flight Deck 2");
      expect(board?.ref).toContain('dashboard "Agent Flight Deck 2" (id board-9)');
      expect(board?.ref).toContain("widgets: Status, Most impactful traces");
      expect(board?.ref).toContain("2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z");
    });
  });

  describe("given a board with nothing on it yet", () => {
    /** @scenario "AC16 Ask Langy from the board" */
    it("says it has no widgets yet", () => {
      const request = boardQuestion({
        question: "What should I add?",
        board: boardSubject({ board: { id: "board-1", name: "My dashboard" }, widgets: [] }),
        period: PERIOD,
      });

      expect(request.context[0]?.ref).toContain("widgets: none yet");
    });
  });
});

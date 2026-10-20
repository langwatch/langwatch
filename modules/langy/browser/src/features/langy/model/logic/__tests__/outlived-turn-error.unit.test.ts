import { describe, expect, it } from "vitest";

import { isTurnErrorOutlived } from "../outlived-turn-error.ts";

/**
 * @see specs/langy/langy-turn-recovery.feature
 */
const completion = { acceptedAt: 2_000, eventId: "evt-2" };

const interrupted = { turnId: "turn-9", completedAlready: false };
const completed = { turnId: "turn-9", status: "completed", cursor: completion };

describe("isTurnErrorOutlived", () => {
  describe("when the interrupted turn went on to complete", () => {
    /** @scenario "An error the turn outlived clears itself" */
    it("clears once the transcript read reaches the completion", () => {
      expect(
        isTurnErrorOutlived({ interrupted, recorded: completed, transcriptCursor: completion }),
      ).toBe(true);
      expect(
        isTurnErrorOutlived({
          interrupted,
          recorded: completed,
          transcriptCursor: { acceptedAt: 3_000, eventId: "evt-3" },
        }),
      ).toBe(true);
    });

    /** @scenario "An error the turn outlived clears itself" */
    it("waits while the transcript read is older than the completion", () => {
      expect(
        isTurnErrorOutlived({
          interrupted,
          recorded: completed,
          transcriptCursor: { acceptedAt: 1_000, eventId: "evt-1" },
        }),
      ).toBe(false);
      expect(
        isTurnErrorOutlived({ interrupted, recorded: completed, transcriptCursor: null }),
      ).toBe(false);
    });

    it("waits while the record has not reached that turn", () => {
      expect(
        isTurnErrorOutlived({
          interrupted,
          recorded: { ...completed, turnId: "turn-8" },
          transcriptCursor: completion,
        }),
      ).toBe(false);
    });
  });

  describe("when the interrupted turn did not complete", () => {
    /** @scenario "A turn that really failed keeps its error card" */
    it("keeps the error for a failed or stopped turn", () => {
      for (const status of ["failed", "stopped", "running"]) {
        expect(
          isTurnErrorOutlived({
            interrupted,
            recorded: { ...completed, status },
            transcriptCursor: completion,
          }),
        ).toBe(false);
      }
    });
  });

  describe("when the error arrived after the turn had already completed", () => {
    /** @scenario "The previous turn's completion never clears an error about a new message" */
    it("keeps the error, because it was about a later send", () => {
      expect(
        isTurnErrorOutlived({
          interrupted: { ...interrupted, completedAlready: true },
          recorded: completed,
          transcriptCursor: completion,
        }),
      ).toBe(false);
    });

    it("keeps an error no turn was in flight for", () => {
      expect(
        isTurnErrorOutlived({
          interrupted: null,
          recorded: completed,
          transcriptCursor: completion,
        }),
      ).toBe(false);
    });
  });
});

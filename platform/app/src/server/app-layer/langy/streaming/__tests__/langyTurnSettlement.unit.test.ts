import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy";
import { describe, expect, it } from "vitest";
import {
  advanceSettlement,
  decideSyntheticTerminal,
  NO_SETTLEMENT_STREAKS,
  shouldAbandonWedgedTurn,
  WEDGED_TURN_PATIENCE_MS,
} from "../langyTurnSettlement";

describe("decideSyntheticTerminal", () => {
  describe("when the turn's heartbeat is still fresh", () => {
    /** @scenario "Stream A stays patient while a turn is still live or cold-starting" */
    it("never synthesizes a terminal, even if the fold looks settled", () => {
      expect(
        decideSyntheticTerminal({
          status: LANGY_CONVERSATION_STATUS.IDLE,
          lastError: null,
          heartbeatStale: false,
        }),
      ).toBeNull();
    });
  });

  describe("when the heartbeat is stale but the fold is still in flight", () => {
    it("stays patient for an ACTIVE turn (a cold start reads in-flight)", () => {
      expect(
        decideSyntheticTerminal({
          status: LANGY_CONVERSATION_STATUS.ACTIVE,
          lastError: null,
          heartbeatStale: true,
        }),
      ).toBeNull();
    });

    it("stays patient for a RUNNING turn", () => {
      expect(
        decideSyntheticTerminal({
          status: LANGY_CONVERSATION_STATUS.RUNNING,
          lastError: null,
          heartbeatStale: true,
        }),
      ).toBeNull();
    });
  });

  describe("when the heartbeat is stale and the fold has settled", () => {
    it("synthesizes an end for a completed (idle) turn", () => {
      expect(
        decideSyntheticTerminal({
          status: LANGY_CONVERSATION_STATUS.IDLE,
          lastError: null,
          heartbeatStale: true,
        }),
      ).toEqual({ type: "end" });
    });

    it("synthesizes an error carrying lastError for a failed turn", () => {
      expect(
        decideSyntheticTerminal({
          status: LANGY_CONVERSATION_STATUS.FAILED,
          lastError: "worker died",
          heartbeatStale: true,
        }),
      ).toEqual({ type: "error", error: "worker died" });
    });

    it("falls back to a generic error message when a failed turn has none", () => {
      expect(
        decideSyntheticTerminal({
          status: LANGY_CONVERSATION_STATUS.FAILED,
          lastError: null,
          heartbeatStale: true,
        }),
      ).toEqual({ type: "error", error: "Turn failed" });
    });
  });

  describe("when the status is unknown or transitional", () => {
    it("does not guess a terminal", () => {
      expect(
        decideSyntheticTerminal({
          status: "some-future-status",
          lastError: null,
          heartbeatStale: true,
        }),
      ).toBeNull();
    });
  });
});

/**
 * The tail used to carry an absolute two-minute deadline as well, taken from
 * the budget for one manager REQUEST. A prompt improvement loop runs for ten
 * minutes, so every one of them went deaf at the two-minute mark: the panel
 * froze on the last thing it had heard, and every agent action after that
 * found no page listening and ran on the backend.
 */
describe("shouldAbandonWedgedTurn", () => {
  const pollMs = 5_000;
  const patientPolls = WEDGED_TURN_PATIENCE_MS / pollMs;

  describe("when the turn is still beating", () => {
    /** @scenario "A turn that runs longer than the manager's request budget keeps its stream" */
    it("keeps the stream however long the turn has run", () => {
      expect(
        shouldAbandonWedgedTurn({
          heartbeatStale: false,
          stalePolls: 0,
          pollMs,
        }),
      ).toBe(false);
    });
  });

  describe("when the heartbeat has only just gone stale", () => {
    it("waits, because one missed beat is not a dead worker", () => {
      expect(
        shouldAbandonWedgedTurn({
          heartbeatStale: true,
          stalePolls: patientPolls - 1,
          pollMs,
        }),
      ).toBe(false);
    });
  });

  describe("when the heartbeat has been stale for the whole patience", () => {
    /** @scenario "A turn that neither settles nor beats gives its stream up" */
    it("gives the stream up", () => {
      expect(
        shouldAbandonWedgedTurn({
          heartbeatStale: true,
          stalePolls: patientPolls,
          pollMs,
        }),
      ).toBe(true);
    });
  });
});

describe("advanceSettlement", () => {
  const pollMs = 5_000;
  const confirmPolls = 2;
  const advance = (
    health: Parameters<typeof advanceSettlement>[0]["health"],
    streaks = NO_SETTLEMENT_STREAKS,
  ) => advanceSettlement({ health, streaks, pollMs, confirmPolls });

  describe("when a settled reading arrives for the first time", () => {
    it("counts it and waits for the confirmation", () => {
      const next = advance({ stale: true, terminal: { type: "end" } });

      expect(next.outcome).toBeNull();
      expect(next.streaks.settled).toBe(1);
    });
  });

  describe("when the settled reading is confirmed", () => {
    it("returns the terminal to synthesize", () => {
      const first = advance({ stale: true, terminal: { type: "end" } });
      const second = advance(
        { stale: true, terminal: { type: "end" } },
        first.streaks,
      );

      expect(second.outcome).toEqual({
        kind: "terminal",
        entry: { type: "end" },
      });
    });
  });

  describe("when a poll could not be made", () => {
    it("counts towards neither verdict and resets both streaks", () => {
      const first = advance({ stale: true, terminal: { type: "end" } });
      const second = advance(null, first.streaks);

      expect(second.outcome).toBeNull();
      expect(second.streaks).toEqual(NO_SETTLEMENT_STREAKS);
    });
  });

  describe("when the turn keeps beating for far longer than a poll", () => {
    it("never decides anything, however many polls go by", () => {
      let streaks = NO_SETTLEMENT_STREAKS;
      for (let poll = 0; poll < 500; poll += 1) {
        const next = advance({ stale: false, terminal: null }, streaks);
        expect(next.outcome).toBeNull();
        streaks = next.streaks;
      }
    });
  });

  describe("when the turn stops beating and never settles", () => {
    it("gives the stream up once the patience is spent", () => {
      let streaks = NO_SETTLEMENT_STREAKS;
      let outcome = null as ReturnType<typeof advance>["outcome"];
      for (let poll = 0; poll < 100 && !outcome; poll += 1) {
        const next = advance({ stale: true, terminal: null }, streaks);
        streaks = next.streaks;
        outcome = next.outcome;
      }

      expect(outcome).toEqual({ kind: "abandoned" });
      expect(streaks.stale * pollMs).toBe(WEDGED_TURN_PATIENCE_MS);
    });
  });
});

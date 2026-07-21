import { describe, expect, it } from "vitest";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import { decideSyntheticTerminal } from "../langyTurnSettlement";

describe("decideSyntheticTerminal", () => {
  describe("when the turn's heartbeat is still fresh", () => {
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

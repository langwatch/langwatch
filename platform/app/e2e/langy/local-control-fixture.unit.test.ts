/**
 * The harness reads of the local-control suite.
 *
 * These pin the pure part of the fixture. The rest of it needs a live stack,
 * so it is only ever exercised by the scenario files.
 */

import { describe, expect, it } from "vitest";
import { answerOfTurn, type StoredMessage } from "./local-control-fixture";

const TURN = "langyturn_783c8761d92af366b9b8da09f8920c21";

const message = (id: string, role: string): StoredMessage => ({
  id,
  role,
  parts: [{ type: "text", text: id }],
});

describe("answerOfTurn", () => {
  describe("when the turn's answer is stored", () => {
    it("takes that answer and not the last one", () => {
      const messages = [
        message("langymsg_turn-langyturn_first", "assistant"),
        message(`langymsg_turn-${TURN}`, "assistant"),
        message("langymsg_user", "user"),
      ];

      expect(answerOfTurn(messages, TURN)?.id).toBe(`langymsg_turn-${TURN}`);
    });
  });

  describe("when only the previous turn's answer is stored", () => {
    it("finds nothing, so the read waits instead of grading the turn before", () => {
      const messages = [
        message("langymsg_turn-langyturn_first", "assistant"),
        message(`langymsg_${TURN.slice("langyturn_".length)}`, "user"),
      ];

      expect(answerOfTurn(messages, TURN)).toBeNull();
    });
  });

  describe("when a message other than an answer carries the turn id", () => {
    it("takes the assistant message, never the other role", () => {
      const messages = [
        message(`langymsg_turn-${TURN}`, "tool"),
        message(`langymsg_turn-${TURN}`, "assistant"),
      ];

      expect(answerOfTurn(messages, TURN)?.role).toBe("assistant");
    });
  });
});

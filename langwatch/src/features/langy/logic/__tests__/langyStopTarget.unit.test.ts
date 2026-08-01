import { describe, expect, it } from "vitest";

import { resolveLangyStopTarget } from "../langyStopTarget";

const base = {
  projectId: "proj-1",
  conversationId: "conv-1",
  localTurnId: null,
  localSettledTurnId: null,
  durableTurnId: null,
};

describe("resolveLangyStopTarget", () => {
  describe("given this tab dispatched the turn", () => {
    it("targets the turn this tab sent", () => {
      const target = resolveLangyStopTarget({
        ...base,
        localTurnId: "turn-mine",
      });

      expect(target).toEqual({
        kind: "dispatch",
        projectId: "proj-1",
        conversationId: "conv-1",
        turnId: "turn-mine",
      });
    });

    describe("when the durable record still names an older turn", () => {
      /** @scenario The turn this tab is streaming is the one Stop targets */
      it("prefers this tab's live turn over the lagging projection", () => {
        const target = resolveLangyStopTarget({
          ...base,
          localTurnId: "turn-new",
          durableTurnId: "turn-old",
        });

        expect(target).toMatchObject({ kind: "dispatch", turnId: "turn-new" });
      });
    });
  });

  describe("given this tab did not start the turn", () => {
    /** @scenario Stopping a turn no open tab owns really stops it */
    it("targets the turn the durable record has in flight", () => {
      const target = resolveLangyStopTarget({
        ...base,
        durableTurnId: "turn-elsewhere",
      });

      expect(target).toMatchObject({
        kind: "dispatch",
        turnId: "turn-elsewhere",
      });
    });

    describe("when this tab's own turn already settled", () => {
      it("hands over to the durable turn rather than re-stopping a finished one", () => {
        const target = resolveLangyStopTarget({
          ...base,
          localTurnId: "turn-finished",
          localSettledTurnId: "turn-finished",
          durableTurnId: "turn-running",
        });

        expect(target).toMatchObject({
          kind: "dispatch",
          turnId: "turn-running",
        });
      });
    });
  });

  describe("given no turn can be named", () => {
    it("reports it cannot dispatch, so the caller cannot claim a stop", () => {
      expect(resolveLangyStopTarget(base)).toEqual({
        kind: "unavailable",
        reason: "turn-not-identified",
      });
    });

    describe("when this tab's only turn already settled and the record names none", () => {
      it("still refuses to target the settled turn", () => {
        expect(
          resolveLangyStopTarget({
            ...base,
            localTurnId: "turn-finished",
            localSettledTurnId: "turn-finished",
          }),
        ).toMatchObject({ reason: "turn-not-identified" });
      });
    });
  });

  describe("given nothing is open to stop", () => {
    it("refuses without a conversation", () => {
      expect(
        resolveLangyStopTarget({
          ...base,
          conversationId: null,
          durableTurnId: "turn-1",
        }),
      ).toEqual({ kind: "unavailable", reason: "no-conversation" });
    });

    it("refuses without a project", () => {
      expect(
        resolveLangyStopTarget({
          ...base,
          projectId: undefined,
          durableTurnId: "turn-1",
        }),
      ).toEqual({ kind: "unavailable", reason: "no-conversation" });
    });
  });
});

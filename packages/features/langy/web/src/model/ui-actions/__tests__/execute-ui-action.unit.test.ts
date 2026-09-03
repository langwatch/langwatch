/**
 * The panel-side orchestration for a dispatched UI action
 * (specs/langy/langy-ui-actions.feature): dedup before claim, no claim
 * without a handler, schema re-parse before the handler, and a completion for
 * every executed or failed run.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeUiAction } from "../execute-ui-action";
import type { LangyUiActionHandlers } from "../langy-ui-action-types";

const ENTRY = {
  actionId: "a1",
  kind: "workbench.duplicateTarget",
  payload: { targetId: "t1" },
};

function makeHandlers(
  run: (payload: never) => unknown = () => ({ targetId: "t2" }),
): LangyUiActionHandlers {
  return {
    "workbench.duplicateTarget": {
      payloadSchema: z.object({ targetId: z.string() }),
      run,
    },
  };
}

function makeLegs() {
  return {
    claim: vi.fn(async () => ({ isClaimed: true })),
    complete: vi.fn(async () => ({ isAccepted: true })),
  };
}

describe("executeUiAction", () => {
  describe("when the same entry arrives twice", () => {
    /** @scenario A replayed stream entry executes the action only once */
    it("executes once and drops the replay before claiming", async () => {
      const seen = new Set<string>();
      const legs = makeLegs();
      const args = {
        entry: ENTRY,
        turnId: "turn-1",
        seen,
        handlers: makeHandlers(),
        ...legs,
      };

      expect(await executeUiAction(args)).toBe("executed");
      expect(await executeUiAction(args)).toBe("duplicate");
      expect(legs.claim).toHaveBeenCalledTimes(1);
      expect(legs.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the page has no handler for the kind", () => {
    /** @scenario A page without a handler leaves the action unclaimed */
    it("does not claim, so the server can fall back", async () => {
      const legs = makeLegs();

      const outcome = await executeUiAction({
        entry: ENTRY,
        turnId: "turn-1",
        seen: new Set(),
        handlers: {},
        ...legs,
      });

      expect(outcome).toBe("no-handler");
      expect(legs.claim).not.toHaveBeenCalled();
    });
  });

  describe("when another tab won the claim", () => {
    it("drops without running the handler", async () => {
      const run = vi.fn();
      const legs = makeLegs();
      legs.claim.mockResolvedValue({ isClaimed: false });

      const outcome = await executeUiAction({
        entry: ENTRY,
        turnId: "turn-1",
        seen: new Set(),
        handlers: makeHandlers(run as never),
        ...legs,
      });

      expect(outcome).toBe("not-claimed");
      expect(run).not.toHaveBeenCalled();
      expect(legs.complete).not.toHaveBeenCalled();
    });
  });

  describe("when the payload fails the page's own schema", () => {
    it("completes with the payload-invalid code and never runs the handler", async () => {
      const run = vi.fn();
      const legs = makeLegs();

      const outcome = await executeUiAction({
        entry: { ...ENTRY, payload: { targetId: 7 } },
        turnId: "turn-1",
        seen: new Set(),
        handlers: makeHandlers(run as never),
        ...legs,
      });

      expect(outcome).toBe("handler-failed");
      expect(run).not.toHaveBeenCalled();
      expect(legs.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          errorCode: "langy_ui_payload_invalid",
        }),
      );
    });
  });

  describe("when the handler runs", () => {
    it("completes with the handler's result", async () => {
      const legs = makeLegs();

      await executeUiAction({
        entry: ENTRY,
        turnId: "turn-1",
        seen: new Set(),
        handlers: makeHandlers(),
        ...legs,
      });

      expect(legs.complete).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, result: { targetId: "t2" } }),
      );
    });

    /** @scenario A browser handler failure reaches the agent as langy_ui_handler_failed and the user as a toast */
    it("completes a typed failure with the handler's own code and tells the user", async () => {
      const legs = makeLegs();
      const onHandlerError = vi.fn();
      const failure = Object.assign(new Error("no such target"), {
        code: "target_not_found",
      });

      const outcome = await executeUiAction({
        entry: ENTRY,
        turnId: "turn-1",
        seen: new Set(),
        handlers: makeHandlers(() => {
          throw failure;
        }),
        ...legs,
        onHandlerError,
      });

      expect(outcome).toBe("handler-failed");
      expect(legs.complete).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, errorCode: "target_not_found" }),
      );
      expect(onHandlerError).toHaveBeenCalledWith({
        kind: ENTRY.kind,
        message: "no such target",
        error: expect.anything(),
      });
    });
  });

  describe("when the handler succeeded but the completion call fails", () => {
    it("does not report it as a handler failure", async () => {
      const legs = makeLegs();
      const onHandlerError = vi.fn();
      legs.complete.mockRejectedValue(new Error("network down"));

      const outcome = await executeUiAction({
        entry: ENTRY,
        turnId: "turn-1",
        seen: new Set(),
        handlers: makeHandlers(),
        ...legs,
        onHandlerError,
      });

      // The page applied the change, so the only thing lost is the report.
      expect(outcome).toBe("completion-failed");
      expect(legs.complete).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      expect(onHandlerError).not.toHaveBeenCalled();
    });
  });

  describe("when the server refuses the completion instead of throwing", () => {
    it("reports the completion as failed, not as executed", async () => {
      const legs = makeLegs();
      const onHandlerError = vi.fn();
      // The pending action, the claimant or the turn no longer match, so the
      // server drops the report. The agent gets no terminal result from it.
      legs.complete.mockResolvedValue({ isAccepted: false });

      const outcome = await executeUiAction({
        entry: ENTRY,
        turnId: "turn-1",
        seen: new Set(),
        handlers: makeHandlers(),
        ...legs,
        onHandlerError,
      });

      expect(outcome).toBe("completion-failed");
      expect(onHandlerError).not.toHaveBeenCalled();
    });
  });

  describe("when the handler failed and its completion call fails too", () => {
    it("still tells the user, and reports the handler failure", async () => {
      const legs = makeLegs();
      const onHandlerError = vi.fn();
      legs.complete.mockRejectedValue(new Error("network down"));

      const outcome = await executeUiAction({
        entry: ENTRY,
        turnId: "turn-1",
        seen: new Set(),
        handlers: makeHandlers(() => {
          throw new Error("no such target");
        }),
        ...legs,
        onHandlerError,
      });

      expect(outcome).toBe("handler-failed");
      expect(onHandlerError).toHaveBeenCalledWith({
        kind: ENTRY.kind,
        message: "no such target",
        error: expect.anything(),
      });
    });
  });
});

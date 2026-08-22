/**
 * The panel-side orchestration for a dispatched UI action
 * (specs/langy/langy-ui-actions.feature): dedup before claim, no claim
 * without a handler, schema re-parse before the handler, and a completion for
 * every executed or failed run.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeUiAction } from "../executeUiAction";
import type { LangyUiActionHandlers } from "../types";

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
    claim: vi.fn(async () => ({ claimed: true })),
    complete: vi.fn(async () => ({ accepted: true })),
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
      legs.claim.mockResolvedValue({ claimed: false });

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
      });
    });
  });
});

/**
 * @vitest-environment jsdom
 * A turn in a conversation the reader can no longer see never leaves the composer on Stop:
 * no fold of that conversation will ever arrive to settle it.
 * @see specs/langy/langy-context-awareness.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useReleaseTurnOfLostConversation } from "../panel/use-langy-panel-errors.ts";

const langy = () => useLangyStore.getState();

const stopEngine = vi.fn();

function renderWith(errorKinds: (string | undefined)[]) {
  return renderHook(
    (props: { errorKinds: (string | undefined)[] }) =>
      useReleaseTurnOfLostConversation({ ...props, stopEngine }),
    { initialProps: { errorKinds } },
  );
}

beforeEach(() => {
  stopEngine.mockReset();
  langy().startNewConversation();
  langy().beginSend();
  langy().beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
});

describe("useReleaseTurnOfLostConversation", () => {
  describe.each(["langy_conversation_not_found", "langy_conversation_not_owned"])(
    "given the turn's conversation failed with %s",
    (kind) => {
      /** @scenario A conversation I can no longer see does not leave Langy working */
      it("puts the composer back on Send", () => {
        renderWith([kind, undefined]);

        expect(langy().turnPhase).toBe("idle");
      });

      /** @scenario A conversation I can no longer see does not leave Langy working */
      it("lets go of the turn's stream, so Send is not held back by it", () => {
        renderWith([kind, undefined]);

        expect(stopEngine).toHaveBeenCalledTimes(1);
      });
    },
  );

  describe("given the history read alone lost the conversation", () => {
    it("puts the composer back on Send and lets go of the stream", () => {
      const hook = renderWith([undefined, undefined]);
      expect(langy().turnPhase).toBe("active");

      hook.rerender({ errorKinds: [undefined, "langy_conversation_not_found"] });

      expect(langy().turnPhase).toBe("idle");
      expect(stopEngine).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a failure that can pass on its own", () => {
    it("leaves the turn and its stream running", () => {
      renderWith(["langy_agent_unavailable", "langy_history_unavailable"]);

      expect(langy().turnPhase).toBe("active");
      expect(stopEngine).not.toHaveBeenCalled();
    });
  });
});

/**
 * @vitest-environment jsdom
 *
 * The composer takes no queue: while a turn is in flight Enter sends nothing,
 * and the draft waits in the field until the turn ends. That is deliberate,
 * but the mid-turn placeholder used to read "Write your next message…", which
 * invites exactly the action that is refused. A user following it typed a
 * message, pressed Enter, and got no message, no error and no sign of either.
 *
 * So the placeholder is pinned here alongside the behaviour it describes.
 *
 * @see specs/langy/langy-composer-feedback-and-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/LangyModelPill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { Composer } from "../components/Composer";
import { useLangyStore } from "../stores/langyStore";

const MID_TURN_PLACEHOLDER = "Langy is working. You can send when it stops.";
const IDLE_PLACEHOLDER = "Ask Langy or describe what you want…";

function renderComposer(onSend: (input: string) => void) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={onSend}
        onStop={() => {}}
        disabled={false}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  useLangyStore.setState({
    activeConversationId: null,
    draft: "",
    turnPhase: "idle",
  });
});

afterEach(cleanup);

describe("given a Langy turn is in flight", () => {
  describe("when the user reads the composer", () => {
    /** @scenario The message field says a message waits while Langy works */
    it("says the message waits, rather than inviting one it will not send", () => {
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(() => {});

      expect(screen.getByPlaceholderText(MID_TURN_PLACEHOLDER)).toBeTruthy();
      expect(screen.queryByPlaceholderText(IDLE_PLACEHOLDER)).toBeNull();
    });

    /** @scenario The message field says the same while the turn is stopping */
    it("says the same while the turn is stopping", () => {
      useLangyStore.setState({ turnPhase: "stopping" });
      renderComposer(() => {});

      expect(screen.getByPlaceholderText(MID_TURN_PLACEHOLDER)).toBeTruthy();
    });
  });

  describe("when the user presses Enter anyway", () => {
    /** @scenario Enter during a turn keeps the message instead of sending it */
    it("sends nothing and keeps the draft for when the turn ends", () => {
      const onSend = vi.fn();
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(onSend);

      const field = screen.getByPlaceholderText(MID_TURN_PLACEHOLDER);
      fireEvent.change(field, { target: { value: "try another version" } });
      fireEvent.keyDown(field, { key: "Enter" });

      expect(onSend).not.toHaveBeenCalled();
      expect(useLangyStore.getState().draft).toBe("try another version");
    });
  });
});

describe("given the turn has ended", () => {
  describe("when the user presses Enter on the draft they typed during it", () => {
    /** @scenario The kept message sends once the turn ends */
    it("sends it", () => {
      const onSend = vi.fn();
      useLangyStore.setState({ turnPhase: "active" });
      const { rerender } = renderComposer(onSend);

      const midTurnField = screen.getByPlaceholderText(MID_TURN_PLACEHOLDER);
      fireEvent.change(midTurnField, {
        target: { value: "try another version" },
      });
      fireEvent.keyDown(midTurnField, { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();

      useLangyStore.setState({ turnPhase: "idle" });
      rerender(
        <ChakraProvider value={defaultSystem}>
          <Composer
            model="openai/gpt-5-mini"
            modelOptions={["openai/gpt-5-mini"]}
            onModelChange={() => {}}
            onSend={onSend}
            onStop={() => {}}
            disabled={false}
          />
        </ChakraProvider>,
      );

      const idleField = screen.getByPlaceholderText(IDLE_PLACEHOLDER);
      fireEvent.keyDown(idleField, { key: "Enter" });

      expect(onSend).toHaveBeenCalledWith("try another version");
    });
  });
});

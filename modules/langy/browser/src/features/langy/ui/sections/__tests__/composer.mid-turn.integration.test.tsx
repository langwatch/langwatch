/**
 * While a turn is in flight the composer still sends: the panel queues what it is handed, and the
 * field says a message sent now goes next.
 * @vitest-environment jsdom
 * @see specs/langy/langy-composer-feedback-and-cards.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The auto-resizing textarea (Ark's field-textarea) reaches for
// ResizeObserver on mount, which jsdom does not implement.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: ({ disabledReason }: { disabledReason?: string }) => (
    <div data-testid="model-pill" data-disabled-reason={disabledReason} />
  ),
}));

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import { Composer } from "../composer.tsx";

const MID_TURN_PLACEHOLDER = "Langy is working. Send a message and it goes next.";
const IDLE_PLACEHOLDER = "Ask Langy or describe what you want…";

function renderComposer(
  onSend: (input: string) => void,
  over: { awaitingAnswer?: boolean; terminalConnected?: boolean } = {},
) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <Composer
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={onSend}
        disabled={false}
        {...over}
      />
    </DesignSystemProvider>,
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

describe("given the turn has ended", () => {
  /** @scenario "A card left from a finished turn does not lock the message field" */
  it("reads the idle placeholder even while a card entry still reads pending", () => {
    useLangyStore.setState({ turnPhase: "idle" });
    renderComposer(() => {}, { awaitingAnswer: true, terminalConnected: true });

    expect(screen.getByPlaceholderText(IDLE_PLACEHOLDER)).toBeTruthy();
    expect(
      screen.queryByPlaceholderText("Answer on the card above or in the terminal."),
    ).toBeNull();
    expect(screen.queryByPlaceholderText(MID_TURN_PLACEHOLDER)).toBeNull();
  });
});

describe("given a Langy turn is in flight", () => {
  describe("when the user reads the composer", () => {
    /** @scenario The message field says a message goes next while Langy works */
    it("says a message sent now goes next", () => {
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(() => {});

      expect(screen.getByPlaceholderText(MID_TURN_PLACEHOLDER)).toBeTruthy();
      expect(screen.queryByPlaceholderText(IDLE_PLACEHOLDER)).toBeNull();
    });

    it("tells the model pill the lock is the turn, so it can say so on hover", () => {
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(() => {});

      expect(screen.getByTestId("model-pill").getAttribute("data-disabled-reason")).toBe(
        "turn-active",
      );
    });

    /** @scenario The message field says the same while the turn is stopping */
    it("says the same while the turn is stopping", () => {
      useLangyStore.setState({ turnPhase: "stopping" });
      renderComposer(() => {});

      expect(screen.getByPlaceholderText(MID_TURN_PLACEHOLDER)).toBeTruthy();
    });

    /** @scenario "The message field points at the card while one is waiting" */
    it("points at the card while one is waiting, and stops blaming Langy", () => {
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(() => {}, { awaitingAnswer: true });

      expect(screen.getByPlaceholderText("Answer the card above to keep going.")).toBeTruthy();
      expect(screen.queryByPlaceholderText(MID_TURN_PLACEHOLDER)).toBeNull();
    });

    /** @scenario "The panel names the terminal while the ask is open there too" */
    it("names the terminal as well when a folder is shared from one", () => {
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(() => {}, {
        awaitingAnswer: true,
        terminalConnected: true,
      });

      expect(
        screen.getByPlaceholderText("Answer on the card above or in the terminal."),
      ).toBeTruthy();
      expect(screen.queryByPlaceholderText("Answer the card above to keep going.")).toBeNull();
    });
  });

  describe("when the user presses Enter", () => {
    /** @scenario Enter during a turn sends the message on to be queued */
    it("hands the message to the panel, which queues it", () => {
      const onSend = vi.fn();
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(onSend);

      const field = screen.getByPlaceholderText(MID_TURN_PLACEHOLDER);
      fireEvent.change(field, { target: { value: "try another version" } });
      fireEvent.keyDown(field, { key: "Enter" });

      expect(onSend).toHaveBeenCalledWith("try another version");
    });

    /** @scenario The composer keeps Send while Langy is working */
    it("shows Send and no Stop", () => {
      useLangyStore.setState({ turnPhase: "active" });
      renderComposer(() => {});

      expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });
  });
});

describe("given the turn has ended", () => {
  describe("when the user presses Enter on the draft they typed during it", () => {
    /** @scenario A message typed during a turn sends once the customer presses Enter */
    it("sends it", () => {
      const onSend = vi.fn();
      useLangyStore.setState({ turnPhase: "active" });
      const { rerender } = renderComposer(onSend);

      const midTurnField = screen.getByPlaceholderText(MID_TURN_PLACEHOLDER);
      fireEvent.change(midTurnField, {
        target: { value: "try another version" },
      });

      useLangyStore.setState({ turnPhase: "idle" });
      rerender(
        <DesignSystemProvider forcedTheme="light">
          <Composer
            model="openai/gpt-5-mini"
            modelOptions={["openai/gpt-5-mini"]}
            onModelChange={() => {}}
            onSend={onSend}
            disabled={false}
          />
        </DesignSystemProvider>,
      );

      const idleField = screen.getByPlaceholderText(IDLE_PLACEHOLDER);
      fireEvent.keyDown(idleField, { key: "Enter" });

      expect(onSend).toHaveBeenCalledWith("try another version");
    });
  });
});

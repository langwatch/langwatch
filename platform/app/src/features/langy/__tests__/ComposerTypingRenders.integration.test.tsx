/**
 * @vitest-environment jsdom
 *
 * Typing in the composer must re-render only the input row. The draft lives in
 * the langy store, so a keystroke updates it; when the whole composer read the
 * draft, every character rebuilt the context menu, the model picker combobox
 * (portal, positioner and all its rows, even closed) and the sigil tooltips —
 * measured at ~580 component renders per character in the browser. The model
 * pill is the canary here: it must not render again because a character was
 * typed.
 *
 * The second block pins the behavior that moved WITH the draft subscription
 * into the input row: Enter sends the draft, and `/` at a word boundary opens
 * the skills palette instead of typing a slash.
 *
 * @see specs/langy/langy-composer-feedback-and-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pillRenders = vi.hoisted(() => ({ count: 0 }));

// The pill is the render-count probe: the real one drags the whole model
// catalogue in, and this test is about WHEN it renders, not what it shows.
vi.mock("../components/LangyModelPill", () => ({
  LangyModelPill: () => {
    pillRenders.count += 1;
    return <div data-testid="model-pill" />;
  },
}));

import { Composer } from "../components/Composer";
import { useLangyStore } from "@langwatch/langy-web";

function renderComposer(onSend: (input: string) => void = () => {}) {
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

const textarea = () =>
  screen.getByPlaceholderText(
    "Ask Langy or describe what you want…",
  ) as HTMLTextAreaElement;

const typeText = (text: string) => {
  const el = textarea();
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(el, { target: { value: text.slice(0, i) } });
  }
};

const resetStore = () =>
  useLangyStore.setState({
    activeConversationId: null,
    draft: "",
    turnPhase: "idle",
  });

describe("given the Langy composer is idle", () => {
  beforeEach(() => {
    resetStore();
    pillRenders.count = 0;
  });
  afterEach(() => {
    cleanup();
    resetStore();
  });

  describe("when the customer types a message one character at a time", () => {
    /** @scenario Typing in the message field leaves the rest of the composer alone */
    it("shows every character and never re-renders the model picker", () => {
      renderComposer();
      const rendersAfterMount = pillRenders.count;
      expect(rendersAfterMount).toBeGreaterThan(0);

      typeText("why is typing slow?");

      expect(textarea().value).toBe("why is typing slow?");
      expect(useLangyStore.getState().draft).toBe("why is typing slow?");
      expect(pillRenders.count).toBe(rendersAfterMount);
    });

    it("enables the send button once the draft has content", () => {
      renderComposer();
      const send = screen.getByRole("button", { name: "Send" });
      expect(send).toBeDisabled();

      typeText("hello");

      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    });
  });

  describe("when the customer presses Enter on a typed message", () => {
    /** @scenario The input row still sends and opens palettes after typing */
    it("sends the draft", () => {
      const onSend = vi.fn();
      renderComposer(onSend);

      typeText("ship it");
      fireEvent.keyDown(textarea(), { key: "Enter" });

      expect(onSend).toHaveBeenCalledWith("ship it");
    });

    it("does not send on Shift+Enter", () => {
      const onSend = vi.fn();
      renderComposer(onSend);

      typeText("line one");
      fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe("when the customer presses the slash key at a word boundary", () => {
    it("opens the skills palette and leaves the typed message alone", () => {
      renderComposer();
      typeText("run ");

      // fireEvent returns false when the handler called preventDefault, which
      // is how the slash is kept out of the field: the key opens the palette
      // instead of reaching the browser's own insertion.
      const reachedTheField = fireEvent.keyDown(textarea(), { key: "/" });

      expect(reachedTheField).toBe(false);
      expect(useLangyStore.getState().draft).toBe("run ");
      expect(screen.getByTestId("langy-palette-title")).toHaveTextContent("Skills");
    });

    it("lets the slash reach the field mid-word instead of opening the palette", () => {
      renderComposer();
      typeText("and/or");

      const reachedTheField = fireEvent.keyDown(textarea(), { key: "/" });

      // Not prevented, so the browser types the character; jsdom does not
      // insert on a synthetic keydown, so the draft is what proves the
      // palette stayed shut and the field kept what was typed.
      expect(reachedTheField).toBe(true);
      expect(useLangyStore.getState().draft).toBe("and/or");
      expect(screen.queryByTestId("langy-palette-title")).not.toBeInTheDocument();
    });
  });
});

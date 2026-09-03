/**
 * @vitest-environment jsdom
 *
 * A new chat exists to be written in: starting one hands the composer keyboard
 * focus so the reader can type at once, without a second gesture.
 *
 * Spec: specs/langy/langy-navigation-persistence.feature
 *
 * Boundary mock: the model picker, whose own dependency chain is irrelevant to
 * a test about focus.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The auto-resizing textarea (Ark's field-textarea) reaches for
// ResizeObserver on mount, which jsdom does not implement. A missing one
// surfaces as an unhandled rejection out of an animation frame rather than as
// a focus assertion failure.
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

vi.mock("../../elements/langy-model-pill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { Composer } from "../composer";
import { useLangyStore } from "../../../../../index";

function renderComposer({
  variant,
}: {
  variant?: "floating" | "sidebar" | "hero";
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        variant={variant}
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        onStop={() => {}}
        disabled={false}
      />
    </ChakraProvider>,
  );
}

const composerField = () => screen.getByRole("textbox");

const resetStore = () =>
  useLangyStore.setState({
    isOpen: false,
    activeConversationId: null,
    draft: "",
    turnPhase: "idle",
    pendingPrompt: null,
    composerFocusRequested: false,
  });

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  resetStore();
});

describe("given the Langy composer after starting a new chat", () => {
  describe("when the reader starts a new chat", () => {
    /** @scenario A new chat opens with the cursor in the composer */
    it("focuses the message field so the next message can just be typed", async () => {
      renderComposer();

      act(() => {
        useLangyStore.getState().startNewConversation();
      });

      await waitFor(() => expect(composerField()).toHaveFocus());
    });
  });
});

describe("given a dialog hands the cursor back", () => {
  /** @scenario A dialog gives the cursor back to the composer when it closes */
  it("focuses the message field on request", async () => {
    renderComposer();

    act(() => {
      useLangyStore.getState().requestComposerFocus();
    });

    await waitFor(() => expect(composerField()).toHaveFocus());
    expect(useLangyStore.getState().composerFocusRequested).toBe(false);
  });
});

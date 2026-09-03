/**
 * @vitest-environment jsdom
 *
 * An `askLangy` handoff ends with the reader about to type, so it hands the
 * cursor to the panel's composer. Focus is taken once, without being asked
 * twice. The hero composer on the home page is the origin of a handoff, never
 * the destination, so it must leave the request alone.
 *
 * The new-chat and dialog-close focus gestures are pinned by the sibling
 * `composer.integration.test.tsx`.
 *
 * Specs: specs/langy/langy-command-bar-activation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

// Cut the model picker's dependency chain — this test is about focus, not the
// picker.
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

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

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

describe("given the Langy composer after an askLangy handoff", () => {
  describe("when the composer is already mounted", () => {
    /** @scenario The composer is ready to keep typing after a handoff */
    it("focuses the message field and consumes the request", async () => {
      renderComposer();

      act(() => {
        useLangyStore.getState().askLangy("what are my traces about?");
      });

      await waitFor(() => expect(composerField()).toHaveFocus());
      expect(useLangyStore.getState().composerFocusRequested).toBe(false);
    });
  });

  describe("when the panel mounts with the handoff", () => {
    /** @scenario The composer is ready to keep typing after a handoff */
    it("focuses on mount from the still-pending request", async () => {
      act(() => {
        useLangyStore.getState().askLangy("find the slowest traces");
      });
      renderComposer();

      await waitFor(() => expect(composerField()).toHaveFocus());
      expect(useLangyStore.getState().composerFocusRequested).toBe(false);
    });
  });

  describe("when only the home hero composer is mounted", () => {
    it("leaves the request for the panel's composer", async () => {
      renderComposer({ variant: "hero" });

      act(() => {
        useLangyStore.getState().askLangy("what changed today?");
      });
      await act(nextFrame);
      await act(nextFrame);

      expect(composerField()).not.toHaveFocus();
      expect(useLangyStore.getState().composerFocusRequested).toBe(true);
    });
  });
});

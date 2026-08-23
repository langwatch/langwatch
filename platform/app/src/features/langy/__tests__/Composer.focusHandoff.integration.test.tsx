/**
 * @vitest-environment jsdom
 *
 * Three gestures end with the reader about to type, so all three hand the
 * cursor to the panel's composer: an `askLangy` handoff, a new chat, and a
 * dialog closing over the panel. Focus is taken once, without being asked
 * twice. The hero composer on the home page is the origin of a handoff, never
 * the destination, so it must leave the request alone.
 *
 * Specs: specs/langy/langy-command-bar-activation.feature,
 * specs/langy/langy-navigation-persistence.feature,
 * specs/langy/langy-model-selection.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cut the model picker's dependency chain — this test is about focus, not the
// picker.
vi.mock("../components/LangyModelPill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { Composer } from "../components/Composer";
import { useLangyStore } from "../stores/langyStore";

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

  describe("when a dialog hands the cursor back", () => {
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

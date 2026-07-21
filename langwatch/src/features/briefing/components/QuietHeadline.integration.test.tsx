/**
 * @vitest-environment jsdom
 *
 * Integration test for the quiet-project invitation. The sheet renders
 * wherever the signal-focused home does, which no longer implies Langy — so
 * the typed first step must stay a live control either way: with Langy it
 * hands the suggestion to a conversation, without it it opens the feature
 * surface that teaches the step.
 *
 * Spec: specs/home/signal-focused-home-rollout.feature
 *
 * Boundary mocks: Langy access, the Langy store, the ambient project and the
 * router. Reduced motion is forced on so the first phrase renders fully
 * typed with no timers to race.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gates = { langy: false };
const askLangy = vi.fn();
const push = vi.fn();

vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: () => gates.langy,
}));
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (
    selector: (state: { askLangy: typeof askLangy }) => unknown,
  ) => selector({ askLangy }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { slug: "acme" } }),
}));
vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => true,
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push }),
}));

import { QuietHeadline } from "./QuietHeadline";

const renderHeadline = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <QuietHeadline />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("QuietHeadline invitation", () => {
  beforeEach(() => {
    gates.langy = false;
    askLangy.mockClear();
    push.mockClear();
  });

  describe("when the reader does not have Langy", () => {
    /** @scenario The quiet invitation adapts to Langy's absence */
    it("opens the feature surface from the typed step and offers no Langy action", () => {
      renderHeadline();

      fireEvent.click(
        screen.getByRole("button", { name: "Learn more: Send a trace" }),
      );

      expect(push).toHaveBeenCalledWith("/acme/messages");
      expect(askLangy).not.toHaveBeenCalled();
      expect(screen.queryByText("Do it with Langy")).toBeNull();
    });
  });

  describe("when the reader has Langy", () => {
    it("hands the typed step to Langy with the question already sent", () => {
      gates.langy = true;
      renderHeadline();

      fireEvent.click(
        screen.getByRole("button", { name: "Ask Langy: Send a trace" }),
      );

      expect(askLangy).toHaveBeenCalledWith(
        expect.stringContaining("first trace"),
      );
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByText("Do it with Langy")).toBeDefined();
    });
  });
});

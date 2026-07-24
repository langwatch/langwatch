/**
 * @vitest-environment jsdom
 *
 * Integration test for the quiet-project invitation. Sending a trace is the
 * one step that unblocks the product, so it leads as a prominent action that
 * lands on the trace surface, present with or without Langy. The OTHER first
 * steps rotate below as a typed invitation that stays a live control either
 * way: with Langy it hands the suggestion to a conversation, without it it
 * opens the feature surface that teaches the step.
 *
 * Spec: specs/home/signal-focused-home-rollout.feature
 *
 * Boundary mocks: Langy access, the Langy store, the ambient project and the
 * router. Reduced motion is forced on so the first rotating phrase renders
 * fully typed with no timers to race.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gates = { langy: false };
const askLangy = vi.fn();
const push = vi.fn();

// The headline's action auto-sends, so the component asks `useCanAskLangy`
// (`langy:create`) rather than `useShowLangy` (`langy:view`). Both are mocked
// off the one gate: the distinction between them is exercised where it is
// decided, not restated in every consumer's fixture.
vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: () => gates.langy,
}));
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => gates.langy,
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

  describe("given a brand-new quiet project", () => {
    /** @scenario The quiet invitation leads with sending the first trace */
    it("leads with a prominent Send your first trace action to the trace surface", () => {
      renderHeadline();

      fireEvent.click(
        screen.getByRole("link", { name: "Send your first trace" }),
      );

      expect(push).toHaveBeenCalledWith("/acme/traces");
    });

    it("rotates the OTHER first steps below, not sending a trace again", () => {
      renderHeadline();

      // Reduced motion pins the first rotating phrase; it is no longer a trace.
      expect(
        screen.getByRole("button", { name: "Learn more: Generate a dataset" }),
      ).toBeDefined();
      expect(screen.queryByRole("button", { name: /Send a trace/ })).toBeNull();
    });
  });

  describe("when the reader does not have Langy", () => {
    /** @scenario The quiet invitation adapts to Langy's absence */
    it("keeps the trace action and opens surfaces, offering no Langy action", () => {
      renderHeadline();

      // The prominent trace action still opens the trace surface.
      fireEvent.click(
        screen.getByRole("link", { name: "Send your first trace" }),
      );
      expect(push).toHaveBeenCalledWith("/acme/traces");

      // The typed first step opens the feature surface that teaches it.
      fireEvent.click(
        screen.getByRole("button", { name: "Learn more: Generate a dataset" }),
      );
      expect(push).toHaveBeenCalledWith("/acme/datasets");

      // No hand-to-Langy anywhere: not the primary, not the rotation.
      expect(askLangy).not.toHaveBeenCalled();
      expect(screen.queryByText("Walk me through it")).toBeNull();
      expect(screen.queryByText("Do it with Langy")).toBeNull();
    });
  });

  describe("when the reader has Langy", () => {
    it("hands the trace step to Langy from Walk me through it", () => {
      gates.langy = true;
      renderHeadline();

      fireEvent.click(
        screen.getByRole("button", {
          name: "Ask Langy how to send your first trace",
        }),
      );

      expect(askLangy).toHaveBeenCalledWith(
        expect.stringContaining("first trace"),
      );
      expect(push).not.toHaveBeenCalled();
    });

    it("hands the rotating step to Langy with the question already sent", () => {
      gates.langy = true;
      renderHeadline();

      fireEvent.click(
        screen.getByRole("button", { name: "Ask Langy: Generate a dataset" }),
      );

      expect(askLangy).toHaveBeenCalledWith(expect.stringContaining("dataset"));
      expect(screen.getByText("Do it with Langy")).toBeDefined();
    });
  });
});

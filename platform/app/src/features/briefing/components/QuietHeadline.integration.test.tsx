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

vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: () => gates.langy,
}));
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => gates.langy,
}));
vi.mock("@langwatch/langy-web", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useLangyStore: (selector: (state: { askLangy: typeof askLangy }) => unknown) =>
    selector({ askLangy }),
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
    describe("when the prominent action is clicked", () => {
      /** @scenario The quiet invitation leads with sending the first trace */
      it("lands on the trace surface", () => {
        renderHeadline();

        fireEvent.click(screen.getByRole("link", { name: "Send your first trace" }));

        expect(push).toHaveBeenCalledWith("/acme/traces");
      });

      it("leaves modified clicks to the browser for open-in-a-tab", () => {
        renderHeadline();

        fireEvent.click(screen.getByRole("link", { name: "Send your first trace" }), {
          metaKey: true,
        });

        expect(push).not.toHaveBeenCalled();
      });
    });

    describe("when the rotation renders under reduced motion", () => {
      it("offers the OTHER first steps, not sending a trace again", () => {
        renderHeadline();

        expect(
          screen.getByRole("button", {
            name: "Learn more: Generate a dataset",
          }),
        ).toBeDefined();
        expect(screen.queryByRole("button", { name: /Send a trace/ })).toBeNull();
      });
    });
  });

  describe("given the reader does not have Langy", () => {
    /** @scenario The quiet invitation adapts to Langy's absence */
    it("offers no Langy hand-off anywhere", () => {
      renderHeadline();

      expect(screen.queryByText("Walk me through it")).toBeNull();
      expect(screen.queryByText("Do it with Langy")).toBeNull();
    });

    describe("when the prominent action is clicked", () => {
      it("still opens the trace surface", () => {
        renderHeadline();

        fireEvent.click(screen.getByRole("link", { name: "Send your first trace" }));

        expect(push).toHaveBeenCalledWith("/acme/traces");
        expect(askLangy).not.toHaveBeenCalled();
      });
    });

    describe("when the typed step is clicked", () => {
      it("opens the feature surface that teaches it", () => {
        renderHeadline();

        fireEvent.click(
          screen.getByRole("button", {
            name: "Learn more: Generate a dataset",
          }),
        );

        expect(push).toHaveBeenCalledWith("/acme/datasets");
        expect(askLangy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the reader has Langy", () => {
    beforeEach(() => {
      gates.langy = true;
    });

    describe("when the walkthrough is chosen", () => {
      it("hands the trace step to Langy", () => {
        renderHeadline();

        fireEvent.click(
          screen.getByRole("button", {
            name: "Ask Langy how to send your first trace",
          }),
        );

        expect(askLangy).toHaveBeenCalledWith(expect.stringContaining("first trace"));
        expect(push).not.toHaveBeenCalled();
      });
    });

    describe("when the rotating step is handed to Langy", () => {
      it("sends its question already composed", () => {
        renderHeadline();

        fireEvent.click(
          screen.getByRole("button", { name: "Ask Langy: Generate a dataset" }),
        );

        expect(askLangy).toHaveBeenCalledWith(expect.stringContaining("dataset"));
        expect(screen.getByText("Do it with Langy")).toBeDefined();
      });
    });
  });
});

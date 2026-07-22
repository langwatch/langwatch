// @vitest-environment jsdom
/**
 * The lit block at the top of the Langy home, and what it puts in its one
 * composer slot.
 *
 * The slot is the whole point: it always holds exactly one of the composer, a
 * quiet line back into the conversation, or a read-only notice — so the block
 * never collapses, and the page under it never jumps. Everything else here is
 * about what the block must NOT do once a conversation exists: no second
 * composer, no second conversation, no error of its own.
 *
 * Boundary mocks: the composer itself (its own suite), the travelling copy, the
 * onboarding pill, and the two data reads (permission, project reach). The
 * store, the ask selection and the block's own branching are real.
 *
 * Spec: specs/home/langy-home.feature, specs/home/langy-home-morph.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = {
  canAsk: true,
  reach: {
    isLoading: false,
    isNewProject: false,
    hasTraces: true,
    hasEvaluations: true,
    hasExperiments: true,
  },
  flight: null as { text: string } | null,
};

vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => reads.canAsk,
}));
vi.mock("../useProjectReach", () => ({
  useProjectReach: () => reads.reach,
}));
vi.mock("~/features/langy/hooks/useComposerMorph", () => ({
  useComposerMorph: () => ({
    flight: reads.flight,
    isFlying: reads.flight !== null,
    reduceMotion: false,
    announcement: "",
    ask: vi.fn(),
  }),
}));
vi.mock("~/features/langy/components/ComposerMorphGhost", () => ({
  ComposerMorphGhost: () => <div data-testid="morph-ghost" />,
}));
vi.mock("~/features/langy/components/Composer", () => ({
  COMPOSER_ANCHOR_ATTR: "data-langy-composer",
  Composer: () => <div data-testid="hero-composer" />,
}));
vi.mock("../OnboardAgentPill", () => ({
  OnboardAgentPill: () => <div data-testid="onboard-pill" />,
}));

import { useLangyStore } from "~/features/langy/stores/langyStore";
import { LangyHomeLantern } from "../LangyHomeLantern";

const renderLantern = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LangyHomeLantern />
    </ChakraProvider>,
  );

/** The example asks are the only buttons the block renders from the ask row. */
const askChips = () =>
  screen.queryAllByRole("button").filter((b) => b.textContent !== "");

beforeEach(() => {
  reads.canAsk = true;
  reads.reach = {
    isLoading: false,
    isNewProject: false,
    hasTraces: true,
    hasEvaluations: true,
    hasExperiments: true,
  };
  reads.flight = null;
  useLangyStore.getState().resetForProject("project-lantern");
  useLangyStore.getState().closePanel();
});

afterEach(cleanup);

describe("<LangyHomeLantern/>", () => {
  describe("given a reader who may read Langy but not start conversations", () => {
    beforeEach(() => {
      reads.canAsk = false;
    });

    /** @scenario A reader who cannot start a conversation is not handed a composer */
    it("offers a line about access instead of a composer, and no asks to send", () => {
      renderLantern();

      expect(screen.queryByTestId("hero-composer")).toBeNull();
      expect(
        screen.getByText(/ask whoever manages your account for access/i),
      ).toBeDefined();
      expect(askChips()).toHaveLength(0);
    });
  });

  describe("given the project's reach is not known yet", () => {
    beforeEach(() => {
      reads.reach = { ...reads.reach, isLoading: true };
    });

    /** @scenario The asks never change under the reader's hand */
    it("shows no example asks rather than ones it would have to withdraw", () => {
      renderLantern();

      expect(screen.getByTestId("hero-composer")).toBeDefined();
      expect(askChips()).toHaveLength(0);
    });
  });

  describe("given the reach has resolved", () => {
    it("offers the asks that project can actually act on", () => {
      renderLantern();

      expect(askChips().length).toBeGreaterThan(0);
    });
  });

  describe("given the composer has left for the panel", () => {
    beforeEach(() => {
      reads.flight = { text: "why are my traces failing" };
    });

    /** @scenario The block does not collapse when the composer leaves */
    it("keeps the bar in its slot while the copy is in the air, so nothing below jumps", () => {
      renderLantern();

      // Hidden, not unmounted: the slot keeps the composer's height for the
      // whole trip. (jsdom has no layout, so occupying the slot is the
      // assertable form of "keeps the composer's height".)
      expect(screen.getByTestId("hero-composer")).toBeDefined();
      expect(screen.getByTestId("morph-ghost")).toBeDefined();
    });
  });

  describe("given a question was sent and the answer has not arrived", () => {
    beforeEach(() => {
      useLangyStore.getState().askLangy("why are my traces failing");
    });

    /** @scenario A slow answer is the panel's business, not the home page's */
    it("stands down to a quiet line and raises no notice of its own", () => {
      renderLantern();

      // Hidden in place, not unmounted: the slot keeps holding the composer's
      // own height so the block never shifts when the panel opens — but a
      // stood-down composer must not be visible or reachable.
      expect(screen.getByTestId("hero-composer")).not.toBeVisible();
      expect(screen.getByText("Continue in Langy")).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    /** @scenario The block does not collapse when the composer leaves */
    it("puts the example asks aside while a conversation is open", () => {
      renderLantern();

      expect(
        askChips().filter((b) => b.textContent !== "Continue in Langy"),
      ).toHaveLength(0);
    });
  });

  describe("given a conversation whose first answer failed", () => {
    beforeEach(() => {
      useLangyStore.getState().openPanel();
      useLangyStore.getState().selectConversation("conv-failed");
    });

    /** @scenario A failed first answer is handled where the conversation is */
    it("shows no failure of its own and still offers the way back in", () => {
      renderLantern();

      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Continue in Langy")).toBeDefined();
    });

    /** @scenario Continuing does not start a second conversation */
    it("takes the reader back to the conversation they already have", () => {
      renderLantern();

      fireEvent.click(screen.getByText("Continue in Langy"));

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.activeConversationId).toBe("conv-failed");
    });
  });
});

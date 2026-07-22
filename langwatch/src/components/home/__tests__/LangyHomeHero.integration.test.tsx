/**
 * @vitest-environment jsdom
 *
 * The hero's zone below the field is typography, not chrome: the asks render
 * as plain text that sends the reader's words to Langy, an empty project adds
 * one quiet line that copies the coding-agent brief, and nothing there opens
 * a menu.
 *
 * Spec: specs/home/langy-home.feature
 *
 * Boundary mocks: the palette (its own feature, with its own tests), the
 * command-bar registration, the Langy store, and the project-reach read. The
 * suggestion selection is real — which asks show IS the behaviour under test.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  canAsk: true,
  reach: {
    isLoading: false,
    isNewProject: false,
    hasTraces: true,
    hasEvaluations: true,
    hasExperiments: true,
  },
};

const askLangy = vi.fn();
const toastCreate = vi.fn();

vi.mock("~/features/command-bar/CommandPalette", () => ({
  CommandPalette: ({ placeholder }: { placeholder?: string }) => (
    <input placeholder={placeholder} />
  ),
}));
vi.mock("~/features/command-bar/CommandBarContext", () => ({
  useCommandBar: () => ({ registerInlinePalette: () => () => {} }),
}));
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => state.canAsk,
}));
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (s: unknown) => unknown) => selector({ askLangy }),
}));
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => toastCreate(...args) },
}));
vi.mock("../dev/homeDevState", () => ({
  useHomeDevState: () => null,
}));
vi.mock("../useProjectReach", () => ({
  useProjectReach: () => state.reach,
}));
vi.mock("../WelcomeHeader", () => ({
  WelcomeHeader: () => null,
}));

import { LangyHomeHero } from "../LangyHomeHero";

const renderHero = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LangyHomeHero />
    </ChakraProvider>,
  );

describe("<LangyHomeHero />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.canAsk = true;
    state.reach = {
      isLoading: false,
      isNewProject: false,
      hasTraces: true,
      hasEvaluations: true,
      hasExperiments: true,
    };
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(cleanup);

  describe("given a project with data", () => {
    /** @scenario The example asks are the ones Langy actually offers */
    it("offers the capable asks and sends the one that is chosen", () => {
      renderHero();

      fireEvent.click(screen.getByRole("button", { name: "Compare two runs" }));

      expect(askLangy).toHaveBeenCalledWith(
        "Compare my last two experiment runs and summarise what changed.",
      );
    });

    it("opens no onboarding menu and offers no setup brief", () => {
      renderHero();

      // Nothing below the field opens a menu — the zone is text, not controls.
      expect(document.querySelector('[aria-haspopup="menu"]')).toBeNull();
      expect(screen.queryByRole("button", { name: /setup brief/i })).toBeNull();
    });
  });

  describe("given a project with nothing in it yet", () => {
    beforeEach(() => {
      state.reach = {
        isLoading: false,
        isNewProject: true,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      };
    });

    /** @scenario A project with nothing in it yet still opens with the composer */
    it("turns the asks into ways to get set up, in the reader's own words", () => {
      renderHero();

      for (const ask of [
        "Onboard my agent",
        "What should I measure?",
        "Show me around",
      ]) {
        expect(screen.getByRole("button", { name: ask })).toBeDefined();
      }
    });

    /** @scenario An empty project offers a setup brief to take away */
    it("copies the coding-agent brief from the quiet line, and says so", async () => {
      renderHero();

      fireEvent.click(
        screen.getByRole("button", {
          name: "or copy a setup brief for your coding agent",
        }),
      );

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          "https://docs.langwatch.ai/integration/overview",
        ),
      );
      await waitFor(() =>
        expect(toastCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: "success" }),
        ),
      );
    });
  });

  describe("given the project's reach is not known yet", () => {
    /** @scenario The asks never change under the reader's hand */
    it("shows no asks and no setup line rather than guessing", () => {
      state.reach = { ...state.reach, isLoading: true, isNewProject: false };
      renderHero();

      expect(screen.queryByRole("button", { name: /./ })).toBeNull();
    });
  });

  describe("given a reader who cannot start conversations", () => {
    beforeEach(() => {
      state.canAsk = false;
    });

    /** @scenario A reader who cannot start a conversation is not handed a composer */
    it("hides the asks and says how to get access", () => {
      renderHero();

      expect(
        screen.queryByRole("button", { name: "Compare two runs" }),
      ).toBeNull();
      expect(
        screen.getByText(/ask whoever manages your account/),
      ).toBeDefined();
    });

    it("still offers the setup brief on an empty project, standing alone", () => {
      // The brief needs no Langy access — and with no asks above it, the line
      // cannot open with a dangling "or".
      state.reach = {
        isLoading: false,
        isNewProject: true,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      };
      renderHero();

      expect(
        screen.getByRole("button", {
          name: "Copy a setup brief for your coding agent",
        }),
      ).toBeDefined();
    });
  });
});

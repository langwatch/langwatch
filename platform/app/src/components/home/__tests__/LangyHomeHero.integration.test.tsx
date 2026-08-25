/**
 * @vitest-environment jsdom
 *
 * The hero's onboarding control, restored: a new project leads with a
 * prominent "Send your first trace" above the ask chips, a populated project
 * keeps the quiet "Onboard your agent" beneath them, and neither renders
 * while the project's reach is still unknown.
 *
 * Spec: specs/home/langy-home.feature
 *
 * Boundary mocks: the command palette (renders its own field), Langy access
 * and store, the ambient dev state, and the project's reach.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/command-bar/CommandPalette", () => ({
  CommandPalette: () => <input placeholder="ask" />,
}));
vi.mock("~/features/command-bar/CommandBarContext", () => ({
  useCommandBar: () => ({ registerInlinePalette: () => () => undefined }),
}));
const canAskMock = vi.fn(() => true);
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => canAskMock(),
}));
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (s: { askLangy: () => void }) => unknown) =>
    selector({ askLangy: vi.fn() }),
}));
vi.mock("../dev/homeDevState", () => ({
  useHomeDevState: () => null,
}));
vi.mock("../WelcomeHeader", () => ({
  WelcomeHeader: () => <div>Good morning</div>,
}));

const reachMock = vi.fn();
vi.mock("../useProjectReach", () => ({
  useProjectReach: () => reachMock(),
}));

import { LangyHomeHero } from "../LangyHomeHero";

function renderHero() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyHomeHero />
    </ChakraProvider>,
  );
}

const onboardingTriggers = () =>
  screen
    .queryAllByRole("button")
    .filter((b) => b.getAttribute("aria-haspopup") === "menu");

beforeEach(() => {
  vi.clearAllMocks();
  canAskMock.mockReturnValue(true);
});

const NEW_PROJECT_REACH = {
  isLoading: false,
  isNewProject: true,
  hasTraces: false,
  hasEvaluations: false,
  hasExperiments: false,
};

const POPULATED_REACH = {
  isLoading: false,
  isNewProject: false,
  hasTraces: true,
  hasEvaluations: true,
  hasExperiments: true,
};

/** True when `a` comes before `b` in the document. */
const renders_before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("LangyHomeHero onboarding control", () => {
  describe("when the project has no traces yet", () => {
    /** @scenario A new project leads with sending the first trace */
    it("leads with a prominent Send your first trace control above the chips", () => {
      reachMock.mockReturnValue(NEW_PROJECT_REACH);
      renderHero();

      const pill = screen.getByText("Send your first trace");
      expect(onboardingTriggers()).toHaveLength(1);
      // ABOVE the ask chips: the pill precedes the empty-project asks.
      const chip = screen.getByText("Show me around");
      expect(renders_before(pill, chip)).toBe(true);
    });

    describe("when the pill's menu is opened with ask access", () => {
      it("offers the walkthrough, the coding-agent prompt, and the docs", async () => {
        reachMock.mockReturnValue(NEW_PROJECT_REACH);
        renderHero();

        await userEvent.click(onboardingTriggers()[0]!);

        expect(await screen.findByText("Walk me through it")).toBeDefined();
        expect(screen.getByText("Copy a prompt for your coding agent")).toBeDefined();
        expect(screen.getByText("Read the integration guide")).toBeDefined();
      });
    });

    describe("when the reader cannot start conversations", () => {
      it("withholds the walkthrough route but keeps the others", async () => {
        canAskMock.mockReturnValue(false);
        reachMock.mockReturnValue(NEW_PROJECT_REACH);
        renderHero();

        await userEvent.click(onboardingTriggers()[0]!);

        expect(
          await screen.findByText("Copy a prompt for your coding agent"),
        ).toBeDefined();
        expect(screen.queryByText("Walk me through it")).toBeNull();
        expect(screen.getByText("Read the integration guide")).toBeDefined();
      });
    });
  });

  describe("when the project is populated", () => {
    /** @scenario A populated project keeps the quiet onboarding route */
    it("keeps the quiet Onboard your agent route beneath the chips", () => {
      reachMock.mockReturnValue(POPULATED_REACH);
      renderHero();

      expect(screen.queryByText("Send your first trace")).toBeNull();
      const pill = screen.getByText("Onboard your agent");
      expect(onboardingTriggers()).toHaveLength(1);
      // BENEATH the ask chips: the populated asks precede the quiet pill.
      const chip = screen.getByText("Compare two runs");
      expect(renders_before(chip, pill)).toBe(true);
    });
  });

  describe("while the project's reach is still unknown", () => {
    it("offers no onboarding control rather than one that swaps", () => {
      reachMock.mockReturnValue({
        isLoading: true,
        isNewProject: false,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      });
      renderHero();

      expect(screen.queryByText("Send your first trace")).toBeNull();
      expect(screen.queryByText("Onboard your agent")).toBeNull();
      expect(onboardingTriggers()).toHaveLength(0);
    });
  });
});

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

describe("LangyHomeHero onboarding control", () => {
  describe("when the project has no traces yet", () => {
    /** @scenario A new project leads with sending the first trace */
    it("leads with a prominent Send your first trace control", () => {
      reachMock.mockReturnValue({
        isLoading: false,
        isNewProject: true,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      });
      renderHero();

      expect(screen.getByText("Send your first trace")).toBeDefined();
      expect(onboardingTriggers()).toHaveLength(1);
      // The chips row still offers the empty-project asks beside it.
      expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    });
  });

  describe("when the project is populated", () => {
    /** @scenario A populated project keeps the quiet onboarding route */
    it("keeps the quiet Onboard your agent route, never the trace lead", () => {
      reachMock.mockReturnValue({
        isLoading: false,
        isNewProject: false,
        hasTraces: true,
        hasEvaluations: true,
        hasExperiments: true,
      });
      renderHero();

      expect(screen.queryByText("Send your first trace")).toBeNull();
      expect(screen.getByText("Onboard your agent")).toBeDefined();
      expect(onboardingTriggers()).toHaveLength(1);
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

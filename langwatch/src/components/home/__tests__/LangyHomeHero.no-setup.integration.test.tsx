/**
 * @vitest-environment jsdom
 *
 * The hero after the setup control moved to the empty states (spec:
 * specs/skills/empty-state-skill-setup.feature). Only the ask chips remain
 * under the field; the onboarding pill is gone in every reach state.
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
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => true,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LangyHomeHero", () => {
  describe("when the project has no traces yet", () => {
    /** @scenario The home no longer carries the setup control */
    it("renders the ask chips row and no onboarding pill", () => {
      reachMock.mockReturnValue({
        isLoading: false,
        isNewProject: true,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      });
      renderHero();

      expect(screen.queryByText(/send your first trace/i)).toBeNull();
      // The "Onboard your agent" ASK CHIP legitimately stays (it is a
      // borrowable prompt); what is gone is the setup MENU control, which
      // was the only menu trigger the hero carried.
      const menuTriggers = screen
        .queryAllByRole("button")
        .filter((b) => b.getAttribute("aria-haspopup") === "menu");
      expect(menuTriggers).toHaveLength(0);
      // The chips row still offers the empty-project asks.
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });
  });

  describe("when the project is populated", () => {
    it("keeps the hero pill-free there too", () => {
      reachMock.mockReturnValue({
        isLoading: false,
        isNewProject: false,
        hasTraces: true,
        hasEvaluations: true,
        hasExperiments: true,
      });
      renderHero();

      expect(screen.queryByText(/send your first trace/i)).toBeNull();
      expect(
        screen
          .queryAllByRole("button")
          .filter((b) => b.getAttribute("aria-haspopup") === "menu"),
      ).toHaveLength(0);
    });
  });
});

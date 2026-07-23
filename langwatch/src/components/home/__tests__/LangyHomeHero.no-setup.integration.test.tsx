/**
 * @vitest-environment jsdom
 *
 * The hero after the setup control moved to the empty states (spec:
 * specs/skills/empty-state-skill-setup.feature) AND the ask chips moved into
 * the command bar. The hero now carries only the field: no onboarding pill, no
 * chip row — the getting-started asks live inside the palette.
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
    /** @scenario The home carries only the field — asks live in the command bar */
    it("renders no chip row and no onboarding pill", () => {
      reachMock.mockReturnValue({
        isLoading: false,
        isNewProject: true,
        hasTraces: false,
        hasEvaluations: false,
        hasExperiments: false,
      });
      renderHero();

      expect(screen.queryByText(/send your first trace/i)).toBeNull();
      // The setup MENU control is gone — it was the only menu trigger the hero
      // carried.
      const menuTriggers = screen
        .queryAllByRole("button")
        .filter((b) => b.getAttribute("aria-haspopup") === "menu");
      expect(menuTriggers).toHaveLength(0);
      // The ask chips moved INTO the command bar, so the hero itself no longer
      // renders any chip buttons — only the field (mocked here as the input).
      expect(screen.queryAllByRole("button")).toHaveLength(0);
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

/**
 * @vitest-environment jsdom
 *
 * The edges of the results list on each surface. The raised bar keeps the
 * field and the list in one card, where a line marks the boundary between
 * them. The home mounts the same palette with the list as its own panel, and
 * there the line drew a second edge a few pixels inside the panel's own.
 *
 * Spec: specs/home/langy-home.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => false,
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "demo" },
    organizations: [],
  }),
}));
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false, NODE_ENV: "test" } }),
}));
vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));
vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => true,
}));
vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user_1" } } }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]",
    query: {},
    asPath: "/demo",
    push: vi.fn(),
  }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));
vi.mock("../useCommandSearch", () => ({
  useCommandSearch: () => ({
    idResult: null,
    searchResults: [],
    isLoading: false,
  }),
}));
vi.mock("../effects/useEasterEggEffects", () => ({
  useEasterEggEffects: () => ({ triggerEffect: vi.fn() }),
}));

import { CommandPalette, type CommandPaletteSurface } from "../CommandPalette";

function renderPalette(surface: CommandPaletteSurface) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CommandPalette
        surface={surface}
        active={true}
        query="analytics"
        setQuery={vi.fn()}
        onDone={vi.fn()}
      />
    </ChakraProvider>,
  );
}

afterEach(() => cleanup());

describe("the command palette results", () => {
  describe("when the home mounts the palette inline", () => {
    /** @scenario The results panel draws one edge, not two */
    it("draws no line above the first group", () => {
      renderPalette("inline");

      expect(screen.getByTestId("command-bar-results")).not.toHaveStyle({
        borderTopWidth: "1px",
      });
    });
  });

  describe("when the raised bar mounts the palette", () => {
    /** @scenario The results panel draws one edge, not two */
    it("keeps the line that separates the list from the field above it", () => {
      renderPalette("dialog");

      expect(screen.getByTestId("command-bar-results")).toHaveStyle({
        borderTopWidth: "1px",
      });
    });
  });
});

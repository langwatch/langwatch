/**
 * @vitest-environment jsdom
 *
 * The no-traces pane: the token comes first, the ways forward sit
 * under it, and the SDK instructions are an action rather than a tab.
 *
 * Spec: specs/traces-v2/integrate-pane.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "demo", name: "Demo", apiKey: null },
    organization: { id: "org_1", name: "ACME" },
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false, NODE_ENV: "test" } }),
}));

vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => true,
}));

vi.mock("@langwatch/langy-web", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useLangyStore: (selector: (s: { askLangy: () => void }) => unknown) =>
    selector({ askLangy: vi.fn() }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    apiKey: { create: { useMutation: () => ({ mutate: vi.fn() }) } },
    personalAccessToken: {
      create: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
    },
    setupSkills: {
      getPrompt: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

// The faded page chrome is the real SearchBar and Toolbar, which pull
// the whole trace page behind them. The pane's own layout is what is
// under test, so the chrome is stubbed out.
vi.mock("../../SearchBar/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("../../Toolbar/Toolbar", () => ({ Toolbar: () => null }));

vi.mock("../../../onboarding/store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setShowSamplePreview: vi.fn(),
      setSpotlightsActive: vi.fn(),
      setCurrentSpotlightId: vi.fn(),
    }),
}));

vi.mock("../../../onboarding/spotlights/SpotlightOverlay", () => ({
  writeSpotlightFragment: vi.fn(),
}));

import { IntegratePane } from "../IntegratePane";

function renderPane() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IntegratePane />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("the integrate pane", () => {
  describe("when a project has no traces", () => {
    /** @scenario The pane leads with the token and keeps its actions under it */
    it("puts the title, then the token area, then the actions", () => {
      renderPane();

      const title = screen.getByText("Instrument your agents in seconds");
      const tokenCard = screen.getByText(/generate an access token/i);
      const actions = screen.getByRole("button", {
        name: /see sdk instructions/i,
      });

      // Document order is the reading order: title, token, actions.
      expect(
        title.compareDocumentPosition(tokenCard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        tokenCard.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /setup via agent/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /see sample data/i }),
      ).toBeInTheDocument();
    });

    /** @scenario The setup paths are not a tab strip */
    it("offers no Skills, MCP, Prompt or SDK tab strip", () => {
      renderPane();

      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(
        screen.queryByText("All four end up in the same explorer."),
      ).not.toBeInTheDocument();
    });

    /** @scenario The SDK instructions open and close from their own button */
    it("opens and closes the SDK instructions from their button", async () => {
      const user = userEvent.setup();
      renderPane();

      const toggle = screen.getByRole("button", {
        name: /see sdk instructions/i,
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      await user.click(toggle);
      await waitFor(() => {
        expect(screen.getByText("Select your platform or language")).toBeInTheDocument();
      });
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      await user.click(toggle);
      await waitFor(() => {
        expect(
          screen.queryByText("Select your platform or language"),
        ).not.toBeInTheDocument();
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });
  });
});

/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveAndRunMenu } from "../SaveAndRunMenu";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/prompts/hooks/useAllPromptsForProject", () => ({
  useAllPromptsForProject: () => ({ data: [] }),
}));

vi.mock("../useFilteredScenarioTargets", () => ({
  isAgentTarget: () => false,
  useFilteredAgents: () => [],
}));

const { mockGetAll } = vi.hoisted(() => ({ mockGetAll: vi.fn() }));
vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getAll: {
        useQuery: mockGetAll,
      },
    },
  },
}));

const renderMenu = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SaveAndRunMenu
        selectedTarget={{ type: "prompt", id: "p1" } as never}
        onTargetChange={vi.fn()}
        onSaveAndRun={vi.fn()}
        onSaveWithoutRunning={vi.fn()}
        onCreateAgent={vi.fn()}
      />
    </ChakraProvider>,
  );

describe("SaveAndRunMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll.mockReturnValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a rendered menu", () => {
    describe("when the menu is closed", () => {
      it("does not enable the agents query", () => {
        renderMenu();

        expect(mockGetAll).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: "project-1" }),
          expect.objectContaining({ enabled: false }),
        );
      });
    });

    describe("when the menu is opened", () => {
      it("enables the agents query", async () => {
        const user = userEvent.setup();
        renderMenu();

        await user.click(screen.getByRole("button", { name: /save and run/i }));

        expect(mockGetAll).toHaveBeenLastCalledWith(
          expect.objectContaining({ projectId: "project-1" }),
          expect.objectContaining({ enabled: true }),
        );
      });
    });
  });
});

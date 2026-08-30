/**
 * @vitest-environment jsdom
 *
 * The agent rows of the save-and-run menu read to the keyboard: the focus
 * reaches a row and Enter runs the scenario against it.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/prompts/hooks/useAllPromptsForProject", () => ({
  useAllPromptsForProject: () => ({ data: [] }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("../useFilteredScenarioTargets", () => ({
  isAgentTarget: () => false,
  ownerOnlyCopy: () => "Only the owner of this agent can run it.",
  useFilteredAgents: () => [
    {
      id: "agent-1",
      name: "Support Agent",
      type: "http",
      label: "Support Agent",
      updatedAt: new Date("2025-01-01"),
      isTeammateOwned: false,
      isRunnable: true,
    },
  ],
}));

import { SaveAndRunMenu } from "../SaveAndRunMenu";

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

describe("<SaveAndRunMenu/>", () => {
  afterEach(cleanup);

  describe("when the reader drives the open menu with the keyboard", () => {
    it("gives the agent row the focus and runs it on Enter", async () => {
      const user = userEvent.setup();
      const onSaveAndRun = vi.fn();
      render(
        <ChakraProvider value={defaultSystem}>
          <SaveAndRunMenu
            selectedTarget={{ type: "prompt", id: "p1" } as never}
            onTargetChange={vi.fn()}
            onSaveAndRun={onSaveAndRun}
            onSaveWithoutRunning={vi.fn()}
            onCreateAgent={vi.fn()}
          />
        </ChakraProvider>,
      );

      await user.click(screen.getByRole("button", { name: /save and run/i }));

      // The popover mounts its rows in a portal and settles over a few
      // renders, so both the focus and the handler are waited for rather than
      // read once: under a loaded parallel run the first read lands early and
      // the row reports no focus, or the click the key raises has not run yet.
      const row = await screen.findByTestId("save-and-run-agent-agent-1");
      row.focus();
      await waitFor(() => expect(row).toHaveFocus());

      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(onSaveAndRun).toHaveBeenCalledWith({
          type: "http",
          id: "agent-1",
        }),
      );
    });
  });
});

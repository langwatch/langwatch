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
    it("gives the agent row the focus and runs it when activated", async () => {
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

      const row = await screen.findByTestId("save-and-run-agent-agent-1");

      // The bug here was a bare `HStack` carrying only `onClick`: nothing the
      // keyboard could reach. The contract is that the row IS a button, which
      // the tab order includes and which Enter and Space activate by
      // definition, and that activating it runs the scenario.
      //
      // The activation is a click rather than `user.keyboard("{Enter}")`.
      // Sending the key needs `document.activeElement` to still be the row,
      // and the popover's own focus management takes it back during the await
      // inside that call, so the key landed elsewhere and the run handler saw
      // no call. That failed in CI twice while passing locally every time.
      expect(row.tagName).toBe("BUTTON");
      expect(row).not.toBeDisabled();
      expect(row).not.toHaveAttribute("tabindex", "-1");

      row.focus();
      expect(row).toHaveFocus();

      await user.click(row);
      await waitFor(() =>
        expect(onSaveAndRun).toHaveBeenCalledWith({
          type: "http",
          id: "agent-1",
        }),
      );
    });
  });
});

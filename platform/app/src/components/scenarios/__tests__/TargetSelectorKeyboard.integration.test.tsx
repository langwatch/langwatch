/**
 * @vitest-environment jsdom
 *
 * The agent rows of the target picker read to the keyboard: the Tab key
 * reaches them and Enter picks the one that has the focus.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mockAgents = [
  {
    id: "agent-1",
    name: "Support Agent",
    type: "http",
    updatedAt: new Date("2025-01-01"),
  },
];

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/prompts/hooks/useAllPromptsForProject", () => ({
  useAllPromptsForProject: () => ({ data: [] }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: { getAll: { useQuery: () => ({ data: mockAgents }) } },
  },
}));

import { TargetSelector, type TargetValue } from "../TargetSelector";

describe("<TargetSelector/>", () => {
  afterEach(cleanup);

  describe("when the reader drives the open list with the keyboard", () => {
    it("gives the agent row the focus and picks it on Enter", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn<(value: TargetValue) => void>();
      render(
        <ChakraProvider value={defaultSystem}>
          <TargetSelector value={null} onChange={onChange} />
        </ChakraProvider>,
      );

      await user.click(screen.getByTestId("target-selector-trigger"));
      await waitFor(() => {
        expect(screen.getByTestId("target-option-agent-1")).toBeInTheDocument();
      });

      const option = screen.getByTestId("target-option-agent-1");
      option.focus();
      expect(option).toHaveFocus();

      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenCalledWith({ type: "http", id: "agent-1" });
    });
  });
});

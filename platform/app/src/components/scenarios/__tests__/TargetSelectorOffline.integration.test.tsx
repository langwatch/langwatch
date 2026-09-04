/**
 * @vitest-environment jsdom
 *
 * The target picker of a scenario run draws a connected agent no process is
 * holding, but does not let it be picked, and says why on hover. An HTTP
 * agent beside it has no presence and stays pickable.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mockAgents = [
  {
    id: "agent-http",
    name: "Support API",
    type: "http",
    updatedAt: new Date("2025-01-02"),
  },
  {
    id: "agent-off",
    name: "support-agent",
    type: "connected",
    environment: "production",
    status: "offline",
    owner: null,
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

import { OFFLINE_AGENT_SELECT_COPY } from "~/components/agents/offlineAgentCopy";
import { TargetSelector, type TargetValue } from "../TargetSelector";

describe("<TargetSelector/> with an offline connected agent", () => {
  afterEach(cleanup);

  describe("when the list is open", () => {
    /** @scenario "The scenario target selector draws an offline agent disabled" */
    it("draws the offline agent disabled and keeps the HTTP agent pickable", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn<(value: TargetValue) => void>();
      render(
        <ChakraProvider value={defaultSystem}>
          <TargetSelector value={null} onChange={onChange} />
        </ChakraProvider>,
      );

      await user.click(screen.getByTestId("target-selector-trigger"));
      await waitFor(() => {
        expect(
          screen.getByTestId("target-option-agent-off"),
        ).toBeInTheDocument();
      });

      const offline = screen.getByTestId("target-option-agent-off");
      expect(offline).toHaveAttribute("aria-disabled", "true");
      await user.hover(offline);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        OFFLINE_AGENT_SELECT_COPY,
      );
      await user.click(offline);
      expect(onChange).not.toHaveBeenCalled();

      const http = screen.getByTestId("target-option-agent-http");
      expect(http).toHaveAttribute("aria-disabled", "false");
      await user.click(http);
      expect(onChange).toHaveBeenCalledWith({ type: "http", id: "agent-http" });
    });
  });
});

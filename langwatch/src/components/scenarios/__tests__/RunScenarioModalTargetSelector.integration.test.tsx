/**
 * @vitest-environment jsdom
 *
 * Integration tests for the RunScenarioModal + TargetSelector interaction.
 *
 * Verifies that clicking items in the TargetSelector dropdown does not
 * close the parent RunScenarioModal due to event propagation to the
 * Dialog overlay's outside-click handler.
 *
 * @see specs/features/suites/run-scenario-target-selector-modal-stability.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrompts = [
  {
    id: "prompt-1",
    handle: "greeting-prompt",
    version: 1,
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: "prompt-2",
    handle: "farewell-prompt",
    version: 1,
    updatedAt: new Date("2025-01-02"),
  },
];

const mockAgents = [
  {
    id: "agent-1",
    name: "Test HTTP Agent",
    type: "http",
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: "agent-2",
    name: "Test Code Agent",
    type: "code",
    updatedAt: new Date("2025-01-02"),
  },
];

// jsdom doesn't implement scrollTo
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
  }),
}));

vi.mock("~/prompts/hooks/useAllPromptsForProject", () => ({
  useAllPromptsForProject: () => ({
    data: mockPrompts,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getAll: {
        useQuery: () => ({ data: mockAgents }),
      },
    },
  },
}));

import { RunScenarioModal } from "../RunScenarioModal";
import type { TargetValue } from "../TargetSelector";

describe("RunScenarioModal with TargetSelector", () => {
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  let onRun: ReturnType<typeof vi.fn<(target: TargetValue, remember: boolean) => void>>;
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    onClose = vi.fn();
    onRun = vi.fn();
    user = userEvent.setup();
  });

  afterEach(() => {
    cleanup();
  });

  function renderModal() {
    return render(
      <ChakraProvider value={defaultSystem}>
        <RunScenarioModal
          open={true}
          onClose={onClose}
          onRun={onRun}
        />
      </ChakraProvider>,
    );
  }

  async function openDropdown() {
    const trigger = screen.getByTestId("target-selector-trigger");
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByTestId("target-selector-dropdown")).toBeInTheDocument();
    });
  }

  describe("when selecting a prompt from the dropdown", () => {
    it("keeps the modal open and shows the selected prompt", async () => {
      renderModal();
      await openDropdown();

      const promptItem = screen.getByText("farewell-prompt");
      await user.click(promptItem);

      // Dropdown closes after selection
      expect(screen.queryByTestId("target-selector-dropdown")).not.toBeInTheDocument();

      // Selected prompt is shown in the trigger
      expect(screen.getByTestId("target-selector-trigger")).toHaveTextContent("farewell-prompt");

      // Modal remains open (onClose was NOT called)
      expect(onClose).not.toHaveBeenCalled();

      // Dialog content is still visible
      expect(screen.getByText("Run Scenario")).toBeInTheDocument();
    });
  });

  describe("when selecting an agent from the dropdown", () => {
    it("keeps the modal open and shows the selected agent", async () => {
      renderModal();
      await openDropdown();

      const agentItem = screen.getByText("Test HTTP Agent");
      await user.click(agentItem);

      // Dropdown closes
      expect(screen.queryByTestId("target-selector-dropdown")).not.toBeInTheDocument();

      // Selected agent shown in trigger
      expect(screen.getByTestId("target-selector-trigger")).toHaveTextContent("Test HTTP Agent");

      // Modal remains open
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Run Scenario")).toBeInTheDocument();
    });
  });

  describe("when clicking inside the modal but outside the dropdown", () => {
    it("closes the dropdown but keeps the modal open", async () => {
      renderModal();
      await openDropdown();

      // Click the modal title text (inside modal, outside dropdown)
      const modalTitle = screen.getByText("Run Scenario");
      await user.click(modalTitle);

      // Dropdown closes
      await waitFor(() => {
        expect(screen.queryByTestId("target-selector-dropdown")).not.toBeInTheDocument();
      });

      // Modal stays open
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Run Scenario")).toBeInTheDocument();
    });
  });

  // Note: "clicking outside the modal closes the modal" is not tested here
  // because Chakra/Ark's backdrop dismiss mechanism relies on internal
  // pointer event handling that doesn't work in jsdom. Our stopPropagation
  // fix is scoped to the dropdown container and cannot affect backdrop behavior.

  describe("when completing the full run flow after selecting a target", () => {
    it("initiates the scenario run with the selected target", async () => {
      renderModal();
      await openDropdown();

      // Select a prompt
      await user.click(screen.getByText("greeting-prompt"));

      // Click Run
      const runButton = screen.getByRole("button", { name: /run/i });
      await user.click(runButton);

      expect(onRun).toHaveBeenCalledWith(
        { type: "prompt", id: "prompt-1" },
        true, // rememberSelection default
      );
    });
  });
});

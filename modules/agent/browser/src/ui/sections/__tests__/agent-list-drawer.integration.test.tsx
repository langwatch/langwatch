/**
 * @vitest-environment jsdom
 * @see specs/agents/agent-management.feature
 */
import { buildCodeConfig } from "@langwatch/agent-contract/code-config";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentBrowser } from "../../../model/agent-client.ts";
import { AgentListDrawer, type AgentListDrawerProps } from "../agent-list-drawer.tsx";

afterEach(cleanup);

const codeProcessor: AgentBrowser = {
  id: "agent_code",
  projectId: "project_1",
  name: "Code Processor",
  type: "code",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  copyCount: 0,
  config: buildCodeConfig({
    code: "def run(message):\n    return message",
    inputs: [{ identifier: "message", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  }),
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
};

const pipelineAgent: AgentBrowser = {
  ...codeProcessor,
  id: "agent_pipeline",
  name: "Pipeline Agent",
};

function renderDrawer(overrides: Partial<AgentListDrawerProps> = {}) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const onCreateNew = vi.fn();
  const props: AgentListDrawerProps = {
    open: true,
    items: [codeProcessor, pipelineAgent],
    isLoading: false,
    onClose,
    onSelect,
    onEdit: vi.fn(),
    onCreateNew,
    onGetRelated: vi.fn().mockResolvedValue({ workflow: null }),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onCascadeArchive: vi.fn().mockResolvedValue({ archivedWorkflow: null }),
    onArchived: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  renderWithDesignSystem(<AgentListDrawer {...props} />);
  return { onClose, onSelect, onCreateNew };
}

describe("AgentListDrawer", () => {
  describe("given agents exist", () => {
    /** @scenario "AgentListDrawer shows available agents" */
    it("lists every agent and offers a New Agent button at the top", () => {
      const mocks = renderDrawer();

      expect(screen.getByText("Code Processor")).toBeTruthy();
      expect(screen.getByText("Pipeline Agent")).toBeTruthy();
      expect(screen.getAllByTestId(/^agent-card-/)).toHaveLength(2);

      const newAgent = screen.getByTestId("new-agent-button");
      expect(newAgent.textContent).toContain("New Agent");
      const firstCard = screen.getByTestId("agent-card-agent_code");
      expect(newAgent.compareDocumentPosition(firstCard)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

      fireEvent.click(newAgent);
      expect(mocks.onCreateNew).toHaveBeenCalledOnce();
    });
  });

  describe("given no agents exist", () => {
    /** @scenario "AgentListDrawer empty state" */
    it("invites the reader to create their first agent and keeps the New Agent button", () => {
      const mocks = renderDrawer({ items: [] });

      expect(screen.queryAllByTestId(/^agent-card-/)).toHaveLength(0);
      expect(screen.getByText("Create your first agent to get started")).toBeTruthy();
      expect(screen.getByTestId("create-first-agent-button").textContent).toContain(
        "Create your first agent",
      );
      expect(screen.getByTestId("new-agent-button").textContent).toContain("New Agent");

      fireEvent.click(screen.getByTestId("create-first-agent-button"));
      expect(mocks.onCreateNew).toHaveBeenCalledOnce();
    });
  });

  describe("when an agent is clicked", () => {
    /** @scenario "Select agent from drawer" */
    it("hands that agent to the caller and closes the drawer", () => {
      const mocks = renderDrawer();

      fireEvent.click(screen.getByTestId("agent-card-agent_code"));

      expect(mocks.onSelect).toHaveBeenCalledExactlyOnceWith(codeProcessor);
      expect(mocks.onClose).toHaveBeenCalledOnce();
    });
  });
});

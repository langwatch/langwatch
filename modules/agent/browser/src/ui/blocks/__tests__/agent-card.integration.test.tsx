/** @vitest-environment jsdom */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentCard, type AgentCardProps } from "../agent-card.tsx";

const agent: AgentCardProps["agent"] = {
  id: "agent_1",
  projectId: "project_1",
  name: "Support bot",
  type: "signature",
  config: { prompt: "Answer clearly" },
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  version: 3,
  createdBy: { id: "user_ada", name: "Ada" },
};

describe("an agent card", () => {
  /** @scenario "The agent card shows who created it and its version" */
  it("shows its creator and its latest version", () => {
    renderWithDesignSystem(<AgentCard agent={agent} updatedAtLabel="1 day ago" />);

    expect(screen.getByTestId("agent-version-agent_1")).toHaveTextContent("v3");
    expect(screen.getByText(/Created by Ada/)).toBeInTheDocument();
  });

  it("leaves the creator out for an agent with none recorded", () => {
    renderWithDesignSystem(
      <AgentCard agent={{ ...agent, createdBy: null }} updatedAtLabel="1 day ago" />,
    );

    expect(screen.queryByText(/Created by/)).not.toBeInTheDocument();
  });
});

/**
 * @vitest-environment jsdom
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockAgents = [
  {
    id: "connected-1",
    name: "support-agent",
    type: "connected",
    status: "online",
    config: { hooks: { setup: true, teardown: true } },
  },
  { id: "http-1", name: "web", type: "http", config: {} },
];

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: { agents: { getAll: { useQuery: () => ({ data: mockAgents }) } } },
}));

import { SelectedTargetHooksHint } from "../selected-target-hooks-hint.tsx";

describe("given the scenario editor hooks line", () => {
  afterEach(cleanup);

  /** @scenario "The scenario editor shows the hooks line for a connected target" */
  it("shows the declared hooks for a connected target", () => {
    renderWithDesignSystem(
      <SelectedTargetHooksHint target={{ type: "connected", id: "connected-1" }} />,
    );

    expect(screen.getByTestId("connected-agent-hooks-hint")).toHaveTextContent(
      "declares setup and teardown hooks",
    );
  });

  /** @scenario "No hooks line shows for an HTTP agent, a prompt or no target" */
  it.each([
    ["an HTTP agent", { type: "http", id: "http-1" } as const],
    ["a prompt", { type: "prompt", id: "prompt-1" } as const],
    ["no target", null],
    ["a connected agent the project does not have", { type: "connected", id: "gone" } as const],
  ])("is absent for %s", (_name, target) => {
    renderWithDesignSystem(<SelectedTargetHooksHint target={target} />);

    expect(screen.queryByTestId("connected-agent-hooks-hint")).not.toBeInTheDocument();
  });
});

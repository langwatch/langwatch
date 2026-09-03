/**
 * @vitest-environment jsdom
 *
 * Connected agents in the run dialog: the presence mark, the environment in
 * the label, the disabled card of another person's development agent, and
 * the warning about an agent no process is holding.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scenarioAgentsOf } from "../../../../../behavior/scenarios/use-filtered-scenario-targets";
import { OfflineTargetsNotice } from "../offline-targets-notice";
import type { RunDialogAgent } from "../run-target-picker";
import { TargetSection } from "../target-section";

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "project" },
    organization: { id: "org_1" },
    team: null,
  }),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const VIEWER = "user_me";

function connectedRow({
  id,
  environment = "production",
  status = "online",
  owner = null,
}: {
  id: string;
  environment?: string;
  status?: "online" | "offline";
  owner?: { userId: string; name: string | null } | null;
}) {
  return {
    id,
    name: "support-agent",
    type: "connected",
    updatedAt: new Date("2026-08-30T09:00:00Z"),
    environment,
    status,
    owner,
  };
}

function agentsFor(rows: ReturnType<typeof connectedRow>[]): RunDialogAgent[] {
  return scenarioAgentsOf({
    agents: rows,
    searchValue: "",
    viewerUserId: VIEWER,
  });
}

function renderSection(agents: RunDialogAgent[]) {
  return render(
    <TargetSection
      mode="agents"
      agents={agents}
      prompts={[]}
      target={null}
      onSelect={vi.fn()}
      onRemovePromptPicker={vi.fn()}
      onSetupAgent={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
}

describe("connected agents in the run dialog", () => {
  afterEach(cleanup);

  describe("given one agent is online and another is offline", () => {
    /** @scenario "The target picker marks an online agent and an offline one" */
    it("marks each card with its presence", () => {
      renderSection(
        agentsFor([
          connectedRow({ id: "agent_on", status: "online" }),
          connectedRow({
            id: "agent_off",
            status: "offline",
            environment: "staging",
          }),
        ]),
      );

      expect(screen.getByTestId("agent-presence-agent_on")).toBeInTheDocument();
      expect(screen.getByText("Online")).toBeInTheDocument();
      expect(screen.getByText("Offline")).toBeInTheDocument();
    });
  });

  describe("given a connected agent in production", () => {
    /** @scenario "The target picker reads the environment of a connected agent" */
    it("reads the name with the environment", () => {
      renderSection(agentsFor([connectedRow({ id: "agent_prod" })]));

      expect(screen.getByText("support-agent · production")).toBeInTheDocument();
    });
  });

  describe("given a development agent that belongs to another person", () => {
    /** @scenario "A teammate's development agent is drawn disabled" */
    it("draws it beside the others, disabled", () => {
      renderSection(
        agentsFor([
          connectedRow({ id: "agent_mine", environment: "production" }),
          connectedRow({
            id: "agent_theirs",
            environment: "development",
            owner: { userId: "user_other", name: "Ana" },
          }),
        ]),
      );

      expect(screen.getByTestId("run-dialog-agent-agent_mine")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      expect(screen.getByTestId("run-dialog-agent-agent_theirs")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    /** @scenario "A teammate's development agent says why on hover" */
    it("says only its owner can run it on hover", async () => {
      const user = userEvent.setup();
      renderSection(
        agentsFor([
          connectedRow({
            id: "agent_theirs",
            environment: "development",
            owner: { userId: "user_other", name: "Ana" },
          }),
        ]),
      );

      await user.hover(screen.getByTestId("run-dialog-agent-agent_theirs"));

      expect(await screen.findByRole("tooltip")).toHaveTextContent("Ana");
    });
  });

  describe("given the chosen agent has no process behind it", () => {
    /** @scenario "The dialog warns when the chosen agent is offline" */
    it("says that no process is running the agent", () => {
      const agents = agentsFor([connectedRow({ id: "agent_off", status: "offline" })]);

      render(
        <OfflineTargetsNotice agents={agents} targets={[{ type: "connected", id: "agent_off" }]} />,
        { wrapper: Wrapper },
      );

      const notice = screen.getByTestId("run-dialog-offline-targets");
      expect(notice).toHaveTextContent(/No process running/);
      expect(notice).toHaveTextContent("support-agent · production");
    });

    it("says nothing when every chosen agent is online", () => {
      const agents = agentsFor([connectedRow({ id: "agent_on", status: "online" })]);

      render(
        <OfflineTargetsNotice agents={agents} targets={[{ type: "connected", id: "agent_on" }]} />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("run-dialog-offline-targets")).toBeNull();
    });
  });
});

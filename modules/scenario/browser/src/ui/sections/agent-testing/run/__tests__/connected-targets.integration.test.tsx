/**
 * Connected agents in the run dialog: presence mark, environment label,
 * disabled cards (another's dev agent, an unheld one), and the plan warning.
 * @vitest-environment jsdom
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { Temporal } from "@langwatch/time";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OFFLINE_AGENT_SELECT_COPY,
  scenarioAgentsOf,
} from "../../../../../behavior/scenarios/use-filtered-scenario-targets.ts";
import type { TargetValue } from "../../../../../model/scenario-target.ts";
import { OfflineTargetsNotice } from "../offline-targets-notice.tsx";
import type { RunDialogAgent } from "../run-target-picker.tsx";
import { TargetSection } from "../target-section.tsx";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "project" },
    organization: { id: "org_1" },
    team: null,
  }),
}));

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
    updatedAt: Temporal.Instant.from("2026-08-30T09:00:00Z"),
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

function renderSection(agents: RunDialogAgent[], target: TargetValue = null) {
  return renderWithDesignSystem(
    <TargetSection
      mode="agents"
      agents={agents}
      prompts={[]}
      target={target}
      onSelect={vi.fn()}
      onRemovePromptPicker={vi.fn()}
      onSetupAgent={vi.fn()}
    />,
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

  describe("given the hooks line under the cards", () => {
    /** @scenario "The run dialog shows the hooks line for the selected connected agent" */
    it("names the hooks the selected online connected agent declares", () => {
      const rows = [
        { ...connectedRow({ id: "agent_h" }), config: { hooks: { setup: true, teardown: false } } },
      ];
      renderSection(agentsFor(rows), { type: "connected", id: "agent_h" });

      expect(screen.getByTestId("connected-agent-hooks-hint")).toHaveTextContent(
        "declares a setup hook",
      );
    });

    /** @scenario "An online agent that declares no hooks says none are declared" */
    it("says none are declared for an online agent without hooks", () => {
      renderSection(agentsFor([connectedRow({ id: "agent_n" })]), {
        type: "connected",
        id: "agent_n",
      });

      expect(screen.getByTestId("connected-agent-hooks-hint")).toHaveTextContent(
        "No setup or teardown hooks declared",
      );
    });

    /** @scenario "No hooks line shows for an HTTP agent, a prompt or no target" */
    it.each([
      ["nothing is selected", connectedRow({ id: "agent_n" }), null],
      [
        "the selected agent is not connected",
        { ...connectedRow({ id: "agent_http" }), type: "http" },
        { type: "http", id: "agent_http" } as const,
      ],
    ])("is absent when %s", (_name, row, target) => {
      renderSection(agentsFor([row]), target);

      expect(screen.queryByTestId("connected-agent-hooks-hint")).not.toBeInTheDocument();
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

  describe("given a connected agent that no process is holding", () => {
    /** @scenario "An offline connected agent cannot be chosen as a run target" */
    it("draws it beside the others, disabled", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderWithDesignSystem(
        <TargetSection
          mode="agents"
          agents={agentsFor([
            connectedRow({ id: "agent_on", status: "online" }),
            connectedRow({
              id: "agent_off",
              status: "offline",
              environment: "staging",
            }),
          ])}
          prompts={[]}
          target={null}
          onSelect={onSelect}
          onRemovePromptPicker={vi.fn()}
          onSetupAgent={vi.fn()}
        />,
      );

      expect(screen.getByTestId("run-dialog-agent-agent_on")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      const offline = screen.getByTestId("run-dialog-agent-agent_off");
      expect(offline).toHaveAttribute("aria-disabled", "true");

      await user.click(offline);
      expect(onSelect).not.toHaveBeenCalled();
    });

    /** @scenario "An offline connected agent says why on hover" */
    it("says the agent is offline on hover", async () => {
      const user = userEvent.setup();
      renderSection(agentsFor([connectedRow({ id: "agent_off", status: "offline" })]));

      await user.hover(screen.getByTestId("run-dialog-agent-agent_off"));

      expect(await screen.findByRole("tooltip")).toHaveTextContent(OFFLINE_AGENT_SELECT_COPY);
    });
  });

  describe("given the chosen agent has no process behind it", () => {
    /** @scenario "The dialog warns when the chosen agent is offline" */
    it("says that no process is running the agent", () => {
      const agents = agentsFor([connectedRow({ id: "agent_off", status: "offline" })]);

      renderWithDesignSystem(
        <OfflineTargetsNotice agents={agents} targets={[{ type: "connected", id: "agent_off" }]} />,
      );

      const notice = screen.getByTestId("run-dialog-offline-targets");
      expect(notice).toHaveTextContent(/No process running/);
      expect(notice).toHaveTextContent("support-agent · production");
    });

    it("says nothing when every chosen agent is online", () => {
      const agents = agentsFor([connectedRow({ id: "agent_on", status: "online" })]);

      renderWithDesignSystem(
        <OfflineTargetsNotice agents={agents} targets={[{ type: "connected", id: "agent_on" }]} />,
      );

      expect(screen.queryByTestId("run-dialog-offline-targets")).toBeNull();
    });
  });
});

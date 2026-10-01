/**
 * Integration tests for ScenarioRunModelDialog: the model picker after choosing a target.
 * @vitest-environment jsdom
 * @see specs/scenarios/scenario-model-selection.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioRunModelDialog } from "../scenario-run-model-dialog.tsx";

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: vi.fn(() => ({
          data: [{ provider: "openai", enabled: true, customModels: [] }],
        })),
      },
      getResolvedDefault: {
        useQuery: vi.fn(() => ({ data: { model: "openai/gpt-5-mini" } })),
      },
    },
  },
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
  })),
}));

describe("<ScenarioRunModelDialog/>", () => {
  afterEach(() => cleanup());

  describe("given the dialog is open", () => {
    describe("when it renders", () => {
      /** @scenario "The save-and-run model dialog lets me choose simulator and judge models" */
      it("shows a user-simulator picker, a judge picker, and runs on confirm", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();

        renderWithDesignSystem(
          <ScenarioRunModelDialog
            open={true}
            onOpenChange={vi.fn()}
            simulatorModel={null}
            judgeModel={null}
            onSimulatorChange={vi.fn()}
            onJudgeChange={vi.fn()}
            onConfirm={onConfirm}
            isRunning={false}
          />,
        );

        expect(screen.getByText("User simulator")).toBeInTheDocument();
        expect(screen.getByText("Judge")).toBeInTheDocument();

        const runButton = screen.getByRole("button", { name: /Save and run/i });
        await user.click(runButton);
        expect(onConfirm).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the dialog is closed", () => {
    it("does not render the pickers", () => {
      renderWithDesignSystem(
        <ScenarioRunModelDialog
          open={false}
          onOpenChange={vi.fn()}
          simulatorModel={null}
          judgeModel={null}
          onSimulatorChange={vi.fn()}
          onJudgeChange={vi.fn()}
          onConfirm={vi.fn()}
          isRunning={false}
        />,
      );

      expect(screen.queryByText("User simulator")).not.toBeInTheDocument();
    });
  });
});

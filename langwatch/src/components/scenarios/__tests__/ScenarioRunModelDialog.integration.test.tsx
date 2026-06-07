/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioRunModelDialog — the model picker shown
 * after a target is chosen in the scenario "Save and run" flow.
 *
 * @see specs/scenarios/scenario-model-selection.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunModelDialog } from "../ScenarioRunModelDialog";

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: vi.fn(() => ({
          data: {
            providers: [{ provider: "openai", enabled: true, customModels: [] }],
          },
        })),
      },
      getResolvedDefault: {
        useQuery: vi.fn(() => ({ data: { model: "openai/gpt-5.5" } })),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
  })),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioRunModelDialog/>", () => {
  afterEach(() => cleanup());

  describe("given the dialog is open", () => {
    describe("when it renders", () => {
      /** @scenario "The save-and-run model dialog lets me choose simulator and judge models" */
      it("shows a user-simulator picker, a judge picker, and runs on confirm", async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();

        render(
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
          { wrapper: Wrapper },
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
      render(
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
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("User simulator")).not.toBeInTheDocument();
    });
  });
});

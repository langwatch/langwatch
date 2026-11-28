/**
 * The view-only notice, save badge and Run button a role that cannot change
 * the workbench sees.
 * @vitest-environment jsdom
 * @see modules/experiment/specs/workbench-view-only-access.feature
 */
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import { uiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { RequestAccessToken, type RequestAccessProps } from "@langwatch/organization-client";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(() => ({
  drawer: vi.fn(),
  targetEditor: vi.fn(),
  evaluatorMappings: vi.fn(),
}));
vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ openDrawer: opened.drawer }),
}));
vi.mock("../../../../behavior/experiments-v3/use-open-target-editor.ts", () => ({
  useOpenTargetEditor: () => ({ openTargetEditor: opened.targetEditor }),
}));
vi.mock("../../../../behavior/experiments-v3/use-open-evaluator-mappings.ts", () => ({
  useOpenEvaluatorMappings: () => opened.evaluatorMappings,
}));
vi.mock("../../../../behavior/experiments-v3/use-prompt-template-fields.ts", () => ({
  usePromptTemplateFields: () => ({}),
}));
const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../../behavior/experiments-v3/use-execute-evaluation.ts", () => ({
  useExecuteEvaluation: () => ({
    status: "idle",
    execute,
    abort: vi.fn(),
    isAborting: false,
  }),
}));

import { RunEvaluationButton } from "../../../sections/experiments-v3/run-evaluation-button.tsx";
import { AutosaveStatus } from "../autosave-status.tsx";
import { WorkbenchViewOnlyBanner } from "../workbench-view-only-banner.tsx";

describe("the workbench for a role that cannot change it", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a role that can view experiments but not change them", () => {
    /** @scenario "A role that cannot change experiments sees the workbench as view only" */
    it("says the experiment is view only, who can give access, and badges saving as View only", () => {
      renderWithDesignSystem(
        <>
          <AutosaveStatus viewOnly evaluationState="idle" datasetState="idle" />
          <WorkbenchViewOnlyBanner access={{ maySave: false, mayRun: false }} />
        </>,
      );

      const notice = screen.getByTestId("workbench-view-only-banner");
      expect(notice).toHaveTextContent("You can view this experiment, but not change it");
      expect(notice).toHaveTextContent("Ask an organization admin for access");
      expect(screen.getByTestId("autosave-view-only")).toHaveTextContent("View only");
    });
  });

  describe("given a Lite Member seat, where organization lends Request access", () => {
    /** Organization's button as its declaration lends it, naming only the reason it was handed. */
    function LentRequestAccess({ reason }: RequestAccessProps) {
      return <button type="button">Request access to {reason}</button>;
    }

    const organizationLendsRequestAccess = {
      ...createUiHostServicesFromHost({
        route: () => ({ params: {}, query: {} }),
        navigate: () => {},
      }),
      declarations: uiDeclarations([
        {
          name: "organization",
          installation: {
            capabilities: {},
            lends: [
              { token: RequestAccessToken, load: async () => ({ default: LentRequestAccess }) },
            ],
          },
        },
      ]),
    };

    /** @scenario "A Lite Member can request access from the view-only notice" */
    it("offers Request access inside the view-only notice", async () => {
      renderWithDesignSystem(
        <UiHostServicesContextProvider value={organizationLendsRequestAccess}>
          <WorkbenchViewOnlyBanner access={{ maySave: false, mayRun: false }} />
        </UiHostServicesContextProvider>,
      );

      const request = await screen.findByRole("button", {
        name: "Request access to run_experiments",
      });
      expect(screen.getByTestId("workbench-view-only-banner")).toContainElement(request);
    });
  });

  describe("given a role that can view experiments but not run evaluations", () => {
    /** @scenario "The Run button says why a role that cannot run evaluations cannot use it" */
    it("marks Run unavailable, ignores a click, and its focus hint and the notice say why", async () => {
      renderWithDesignSystem(
        <>
          <RunEvaluationButton mayRun={false} />
          <WorkbenchViewOnlyBanner access={{ maySave: true, mayRun: false }} />
        </>,
      );

      const run = screen.getByTestId("run-evaluation-button");
      expect(run).toHaveAttribute("aria-disabled", "true");
      // Keyboard users reach the hint too: the button keeps its focus.
      await userEvent.tab();
      expect(run).toHaveFocus();
      expect(
        await screen.findByText(
          "Your role can't run evaluations. Ask an organization admin for access.",
        ),
      ).toBeInTheDocument();
      await userEvent.click(run);
      // A denied click starts nothing: no run, and no drawer asking for a target or mapping.
      expect(execute).not.toHaveBeenCalled();
      expect(opened.drawer).not.toHaveBeenCalled();
      expect(opened.targetEditor).not.toHaveBeenCalled();
      expect(opened.evaluatorMappings).not.toHaveBeenCalled();
      const notice = screen.getByTestId("workbench-view-only-banner");
      expect(notice).toHaveTextContent(/role can.t run evaluations/i);
      // Saving still works for this role, so the notice does not say edits stay in the tab.
      expect(notice).not.toHaveTextContent("stay in this tab");
    });
  });
});

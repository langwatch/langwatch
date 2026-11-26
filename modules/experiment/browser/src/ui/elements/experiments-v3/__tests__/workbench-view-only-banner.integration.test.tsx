/**
 * The view-only notice, save badge and Run button a role that cannot change
 * the workbench sees.
 * @vitest-environment jsdom
 * @see modules/experiment/specs/workbench-view-only-access.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/drawer", () => ({ useDrawer: () => ({ openDrawer: vi.fn() }) }));
vi.mock("../../../../behavior/experiments-v3/use-open-target-editor.ts", () => ({
  useOpenTargetEditor: () => ({ openTargetEditor: vi.fn() }),
}));
vi.mock("../../../../behavior/experiments-v3/use-open-evaluator-mappings.ts", () => ({
  useOpenEvaluatorMappings: () => vi.fn(),
}));
vi.mock("../../../../behavior/experiments-v3/use-prompt-template-fields.ts", () => ({
  usePromptTemplateFields: () => ({}),
}));
vi.mock("../../../../behavior/experiments-v3/use-execute-evaluation.ts", () => ({
  useExecuteEvaluation: () => ({
    status: "idle",
    execute: vi.fn(),
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

  describe("given a role that can view experiments but not run evaluations", () => {
    /** @scenario "The Run button says why a role that cannot run evaluations cannot use it" */
    it("disables Run, and its hint and the notice say the role can't run evaluations", async () => {
      renderWithDesignSystem(
        <>
          <RunEvaluationButton mayRun={false} />
          <WorkbenchViewOnlyBanner access={{ maySave: true, mayRun: false }} />
        </>,
      );

      expect(screen.getByTestId("run-evaluation-button")).toBeDisabled();
      await userEvent.hover(screen.getByTestId("run-evaluation-button-trigger"));
      expect(
        await screen.findByText(
          "Your role can't run evaluations. Ask an organization admin for access.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("workbench-view-only-banner")).toHaveTextContent(
        "Your role can't run evaluations",
      );
    });
  });
});

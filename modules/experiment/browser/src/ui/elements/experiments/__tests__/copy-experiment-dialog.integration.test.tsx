// @vitest-environment jsdom
/**
 * Experiment's Replicate dialog lists the targets workflow's host answers
 * through the `workflow:host` slice, with no provider above it.
 * Spec: specs/ui/browser-global-store.feature
 */
import { defineSlice } from "@langwatch/browser-host/global-store";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { WORKFLOW_HOST_SLICE, type WorkflowHostSlice } from "@langwatch/workflow-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "proj" } }),
}));

import { CopyExperimentDialog } from "../copy-experiment-dialog.tsx";

const asked: string[] = [];

/** Stands in for workflow's host mount, the slice's owner. */
function publishWorkflowHost() {
  const nothing = () => void 0;
  defineSlice<WorkflowHostSlice>({
    name: WORKFLOW_HOST_SLICE,
    create: () => ({
      scope: () => ({ projectId: "project_1", projectSlug: "proj" }),
      hasPermission: () => true,
      copyTargets: ({ permission }) => {
        asked.push(permission);
        return [
          { id: "project_2", name: "Acme / Engineering / Web App", canCreate: true },
          { id: "project_3", name: "Acme / Engineering / Batch", canCreate: false },
        ];
      },
      route: () => ({ params: {}, query: {} }),
      setQuery: nothing,
      navigate: nothing,
      back: nothing,
      succeeded: nothing,
      failed: nothing,
    }),
  });
}

afterEach(() => {
  cleanup();
  asked.length = 0;
});

describe("given workflow published its host actions as the workflow:host slice", () => {
  describe("when a customer opens experiment's Replicate dialog", () => {
    /** @scenario "Workflow's host actions reach another module through the store" */
    it("lists the targets workflow's host answered and refuses the closed one", async () => {
      publishWorkflowHost();
      const user = userEvent.setup({ pointerEventsCheck: 0 });

      renderWithDesignSystem(
        <CopyExperimentDialog open onClose={vi.fn()} isCopying={false} onCopy={vi.fn()} />,
      );
      await user.click(await screen.findByRole("combobox"));

      expect(
        (await screen.findAllByRole("option", { name: /Web App/, hidden: true })).length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("(no permission)")).toBeTruthy();
      expect(asked).toContain("evaluations:manage");
    });
  });
});

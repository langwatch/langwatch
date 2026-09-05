/**
 * @vitest-environment jsdom
 * @see specs/workflows/workflow-management.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/workflow-api", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    workflowApi: {
      useUtils: () => ({ workflow: { getAll: { invalidate: vi.fn() } } }),
      workflow: {
        create: { useMutation: mutation },
        archive: { useMutation: mutation },
        cascadeArchive: { useMutation: mutation },
        syncFromSource: { useMutation: mutation },
        getRelatedEntities: { useQuery: () => ({ data: undefined, isLoading: false }) },
      },
    },
  };
});

vi.mock("../../../model/workflow-host", () => ({
  useWorkflowHost: () => ({
    scope: () => ({ projectId: "project_1", projectSlug: "project-one" }),
    navigate: vi.fn(),
    failed: vi.fn(),
  }),
}));

vi.mock("../../blocks/workflow-emoji-picker", () => ({
  WorkflowEmojiPicker: () => null,
}));

import { WorkflowCreateDialogHost } from "../workflow-create-dialog-host";

describe("WorkflowCreateDialogHost", () => {
  afterEach(cleanup);

  describe("when the blank template is chosen", () => {
    /** @scenario "The create dialog's submit button says what it creates" */
    it("offers a submit button reading Create workflow", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <WorkflowCreateDialogHost open onClose={vi.fn()} />
        </ChakraProvider>,
      );

      fireEvent.click(screen.getByTestId("new-workflow-card-blank"));

      expect(screen.getByRole("button", { name: "Create workflow" })).toBeInTheDocument();
      expect(screen.queryByText("Create StudioWorkflow")).toBeNull();
    });
  });
});

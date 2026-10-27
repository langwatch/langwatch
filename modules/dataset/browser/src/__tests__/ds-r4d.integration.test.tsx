/**
 * @vitest-environment jsdom
 * Dialogs that validate on submit: Replicate and Add rows from CSV answer a click with what is
 * missing instead of sitting disabled, and send nothing until it is supplied.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithDatasetHost } from "../testing.tsx";

const { copyMutate, createRecords } = vi.hoisted(() => ({
  copyMutate: vi.fn(),
  createRecords: vi.fn(),
}));

vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({ datasetRecord: { invalidate: vi.fn() } }),
    dataset: { copy: { useMutation: () => ({ mutateAsync: copyMutate, isPending: false }) } },
    datasetRecord: { create: { useMutation: () => ({ mutate: createRecords, isPending: false }) } },
  },
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1", slug: "test-project" } }),
}));

import { CopyDatasetDialog } from "../ui/sections/copy-dataset-dialog.tsx";
import { AddRowsFromCSVModal } from "../ui/sections/datasets/add-rows-from-csv-modal.tsx";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given the replicate dialog with no target chosen", () => {
  const renderDialog = () =>
    renderWithDatasetHost(
      <CopyDatasetDialog open onClose={vi.fn()} datasetId="ds-1" datasetName="offline evals" />,
      { copyTargets: [{ value: "proj-2", label: "Second project" }] },
    );

  describe("when Replicate is pressed", () => {
    it("says a project is needed, focuses the picker and replicates nothing", async () => {
      const user = userEvent.setup();
      renderDialog();

      const replicate = screen.getByRole("button", { name: "Replicate" });
      expect(replicate).toBeEnabled();
      await user.click(replicate);

      expect(
        await screen.findByText("Choose the project to replicate the dataset to."),
      ).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /target project/i })).toHaveFocus();
      expect(copyMutate).not.toHaveBeenCalled();
    });
  });
});

describe("given the add rows dialog with no file chosen", () => {
  describe("when Upload is pressed", () => {
    it("asks for a CSV file and uploads nothing", async () => {
      const user = userEvent.setup();
      renderWithDatasetHost(
        <AddRowsFromCSVModal
          isOpen
          onClose={vi.fn()}
          datasetId="ds-1"
          columnTypes={[{ name: "input", type: "string" }]}
        />,
      );

      const upload = screen.getByTestId("dataset-add-rows-submit");
      expect(upload).toBeEnabled();
      await user.click(upload);

      expect(
        await screen.findByText("Choose a CSV file with at least one row."),
      ).toBeInTheDocument();
      expect(createRecords).not.toHaveBeenCalled();
    });
  });
});

/**
 * @vitest-environment jsdom
 * A bare-address open (no caller, `onSuccess` unset) must submit and close
 * (dev/docs/best_practices/drawers.md), not throw.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const closeDrawer = vi.fn();
const created = vi.fn();

vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDrawer: () => ({ closeDrawer }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1", slug: "acme" } }),
}));

const toasts: { title?: string }[] = [];
vi.mock("@langwatch/browser-host/toaster", () => ({
  toaster: { create: (toast: { title?: string }) => toasts.push(toast) },
}));

vi.mock("@langwatch/browser-host/errors", () => ({
  describeError: () => "",
  showErrorToast: () => void 0,
}));

/**
 * The mutation, answering the way tRPC does: `mutate` runs the caller's own
 * `onSuccess` with the written row. That callback is where the crash lived, so
 * a double that never calls it would prove nothing.
 */
vi.mock("../../../../behavior/dataset-api.ts", () => ({
  datasetApi: {
    useUtils: () => ({ dataset: { getAll: { invalidate: () => void 0 } } }),
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({ dataset: { getAll: { invalidate: () => void 0 } } }),
    dataset: {
      upsert: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: { name: string; columnTypes: unknown },
            handlers: { onSuccess: (row: unknown) => void },
          ) => {
            created(input);
            handlers.onSuccess({
              id: "dataset_1",
              name: input.name,
              columnTypes: input.columnTypes,
            });
          },
        }),
      },
      getById: { useQuery: () => ({ data: void 0 }) },
      validateDatasetName: { useQuery: () => ({ refetch: () => Promise.resolve({}) }) },
    },
  },
}));

import { AddOrEditDatasetDrawer } from "../add-or-edit-dataset-drawer.tsx";

const mount = (element: ReactElement) => renderWithDesignSystem(element);

describe("given the dataset editor opened from a bare drawer address", () => {
  describe("when the reader names a dataset and creates it", () => {
    /** @scenario "A bare-URL open of the dataset editor creates the dataset and closes" */
    /** @scenario "A sub-flow target with no caller closes the drawer itself" */
    it("writes the dataset and closes, with no caller to tell", async () => {
      mount(<AddOrEditDatasetDrawer open />);

      // `fireEvent.change` rather than a typed run: the name field re-renders
      // on every keystroke behind the slug check, and what this case is about
      // is the submit, not the typing.
      fireEvent.change(await screen.findByRole("textbox", { name: /name/i }), {
        target: { value: "Golden set" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

      await waitFor(() => expect(created).toHaveBeenCalled());
      expect(created.mock.calls[0]?.[0]).toMatchObject({ name: "Golden set" });
      expect(closeDrawer).toHaveBeenCalled();
    });
  });

  describe("when the drawer proposes the columns for a new dataset", () => {
    /** @scenario "A new dataset ends with an annotations column" */
    it("names the last column annotations and holds a string in it", () => {
      mount(<AddOrEditDatasetDrawer open />);

      const names = screen
        .getAllByPlaceholderText("Column name")
        .map((input) => (input as HTMLInputElement).value);

      expect(names.at(-1)).toBe("annotations");
      expect(names).toEqual([
        "trace_id",
        "timestamp",
        "input",
        "output",
        "contexts",
        "total_cost",
        "annotations",
      ]);
    });
  });
});

describe("given the dataset editor opened on an existing dataset", () => {
  describe("when the reader edits its name and column after it loads", () => {
    /** @scenario "An edited dataset's typed name and column are the ones applied" */
    it("applies the typed values, not the loaded ones", async () => {
      const applied = vi.fn();
      mount(
        <AddOrEditDatasetDrawer
          open
          localOnly
          onSuccess={applied}
          datasetToSave={{
            datasetId: "dataset_1",
            name: "Old name",
            columnTypes: [{ name: "input", type: "string" }],
          }}
        />,
      );

      const nameInput = await screen.findByDisplayValue("Old name");
      // The loaded values land after layout; let that reset run before typing.
      await new Promise((resolve) => setTimeout(resolve, 10));
      fireEvent.change(nameInput, { target: { value: "New name" } });
      fireEvent.change(screen.getByDisplayValue("input"), { target: { value: "question" } });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      await waitFor(() => expect(applied).toHaveBeenCalled());
      expect(applied.mock.calls[0]?.[0]).toMatchObject({
        name: "New name",
        columnTypes: [{ name: "question", type: "string" }],
      });
    });
  });
});

describe("given the dataset editor opened on columns that carry the caller's ids", () => {
  const datasetToSave = {
    datasetId: "dataset_1",
    name: "Columns",
    columnTypes: [
      { id: "input_0", name: "input", type: "string" as const },
      { id: "test_1", name: "test", type: "string" as const },
    ],
  };

  const renameTestAndAddColumn = async () => {
    await screen.findByDisplayValue("test");
    await new Promise((resolve) => setTimeout(resolve, 10));
    fireEvent.change(screen.getByDisplayValue("test"), { target: { value: "test2" } });
    fireEvent.click(screen.getByTestId("dataset-column-add"));
    fireEvent.change(screen.getByTestId("dataset-column-name-2"), { target: { value: "extra" } });
  };

  describe("when the reader renames one column and adds another, applying locally", () => {
    /** @scenario "The dataset editor hands back each edited column with the caller's id for it" */
    it("hands back the renamed column with its id and the new one without", async () => {
      const applied = vi.fn();
      mount(
        <AddOrEditDatasetDrawer open localOnly onSuccess={applied} datasetToSave={datasetToSave} />,
      );

      await renameTestAndAddColumn();
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

      await waitFor(() => expect(applied).toHaveBeenCalled());
      expect(applied.mock.calls[0]?.[0].columnTypes).toEqual([
        { id: "input_0", name: "input", type: "string" },
        { id: "test_1", name: "test2", type: "string" },
        { name: "extra", type: "string" },
      ]);
    });
  });

  describe("when the reader renames a saved dataset's column and saves", () => {
    /** @scenario "The dataset editor hands back each edited column with the caller's id for it" */
    /** @scenario "A save that deletes one column and renames another keeps the renamed column's values" */
    it("saves plain columns and hands back the saved ones with the caller's ids", async () => {
      const saved = vi.fn();
      created.mockClear();
      mount(<AddOrEditDatasetDrawer open onSuccess={saved} datasetToSave={datasetToSave} />);

      await renameTestAndAddColumn();
      fireEvent.click(screen.getByTestId("dataset-form-submit"));

      await waitFor(() => expect(saved).toHaveBeenCalled());
      expect(created.mock.calls[0]?.[0].columnTypes).toEqual([
        { name: "input", type: "string" },
        { name: "test2", type: "string" },
        { name: "extra", type: "string" },
      ]);
      expect(created.mock.calls[0]?.[0].columnRenames).toEqual([{ from: "test", to: "test2" }]);
      expect(saved.mock.calls[0]?.[0].columnTypes).toEqual([
        { id: "input_0", name: "input", type: "string" },
        { id: "test_1", name: "test2", type: "string" },
        { name: "extra", type: "string" },
      ]);
    });
  });
});

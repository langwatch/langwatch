/**
 * @vitest-environment jsdom
 * The datasets screen's edit drawer names its renames, so a save that deletes one
 * column and renames another cannot hand the deleted column's values to the renamed one.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithDatasetHost } from "../../../testing.tsx";

const { upserted } = vi.hoisted(() => ({ upserted: vi.fn() }));

vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({ dataset: { getAll: { invalidate: () => undefined } } }),
    dataset: {
      upsert: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: { name: string; columnTypes: unknown },
            handlers: { onSuccess: (row: unknown) => void },
          ) => {
            upserted(input);
            handlers.onSuccess({ id: "ds-1", name: input.name, columnTypes: input.columnTypes });
          },
        }),
      },
      getById: { useQuery: () => ({ data: undefined }) },
      validateDatasetName: {
        useQuery: () => ({ data: undefined, refetch: () => Promise.resolve({}) }),
      },
    },
  },
}));

const { AddOrEditDatasetDrawer } = await import("../add-or-edit-dataset-drawer.tsx");

describe("given the datasets screen's drawer editing a saved dataset", () => {
  describe("when one column is deleted and another renamed in the same save", () => {
    /** @scenario "A save that deletes one column and renames another keeps the renamed column's values" */
    it("sends the rename alongside the columns", async () => {
      renderWithDatasetHost(
        <AddOrEditDatasetDrawer
          open
          onClose={() => undefined}
          onSuccess={() => undefined}
          datasetToSave={{
            datasetId: "ds-1",
            name: "Saved",
            columnTypes: [
              { name: "first", type: "string" },
              { name: "second", type: "string" },
            ],
          }}
        />,
      );

      await screen.findByDisplayValue("second");
      fireEvent.click(screen.getAllByRole("button", { name: "Remove column" })[0]!);
      fireEvent.change(screen.getByDisplayValue("second"), { target: { value: "renamed" } });
      fireEvent.click(screen.getByTestId("dataset-form-submit"));

      await waitFor(() => expect(upserted).toHaveBeenCalled());
      expect(upserted.mock.calls[0]?.[0]).toMatchObject({
        columnTypes: [{ name: "renamed", type: "string" }],
        columnRenames: [{ from: "second", to: "renamed" }],
      });
      expect(upserted.mock.calls[0]?.[0].columnTypes[0]).not.toHaveProperty("source");
    });
  });
});

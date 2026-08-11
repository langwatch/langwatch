/**
 * @vitest-environment jsdom
 *
 * The columns a brand new dataset is proposed with. The last one carries what
 * the reviewers said about each trace, and its name is what the mapping infers
 * its source from.
 * See specs/datasets/dataset-annotations-mapping.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      upsert: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      getById: { useQuery: () => ({ data: undefined }) },
      validateDatasetName: { useQuery: () => ({ data: undefined }) },
    },
    useContext: () => ({ dataset: { getAll: { invalidate: vi.fn() } } }),
  },
}));

const { AddOrEditDatasetDrawer } = await import("../AddOrEditDatasetDrawer");

/** The column-name inputs, in the order the drawer proposes them. */
function proposedColumnNames(): string[] {
  return screen
    .getAllByPlaceholderText("Column name")
    .map((input) => (input as HTMLInputElement).value);
}

afterEach(cleanup);

describe("given I am creating a new dataset from the add-to-dataset drawer", () => {
  describe("when the drawer proposes the columns", () => {
    /** @scenario "A new dataset ends with an annotations column" */
    it("names the last column annotations and holds a string in it", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <AddOrEditDatasetDrawer open onSuccess={vi.fn()} />
        </ChakraProvider>,
      );

      const names = proposedColumnNames();
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

      const types = screen
        .getAllByRole("combobox")
        .map((select) => (select as HTMLSelectElement).value);
      expect(types.at(-1)).toBe("string");
    });
  });
});

/**
 * @vitest-environment jsdom
 * @see specs/experiments-v3/dataset-management.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useEvaluationsV3Store } from "../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import type { DatasetReference } from "../../../../model/experiments-v3/types.ts";
import { extractPersistedState } from "../../../../model/experiments-v3/types.ts";
import { WorkbenchRowsCutBanner } from "../workbench-rows-cut-banner.tsx";

const savedDataset = (): DatasetReference => ({
  id: "saved_dataset-1",
  name: "Scans",
  type: "saved",
  datasetId: "dataset-1",
  columns: [{ id: "image_0", name: "image", type: "image" }],
});

/** The banner as the workbench screen shows it: only for an active dataset the grid cut short. */
function ActiveDatasetRowsNotice() {
  const cut = useEvaluationsV3Store(
    (state) =>
      state.datasets.find((dataset) => dataset.id === state.activeDatasetId)?.savedRecordsCut,
  );

  return cut ? <WorkbenchRowsCutBanner cut={cut} /> : null;
}

describe("the workbench rows notice", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.getState().addDataset(savedDataset());
    useEvaluationsV3Store.getState().setActiveDataset("saved_dataset-1");
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a saved dataset of 10,000 rows of which the grid loaded the first 1,200", () => {
    beforeEach(() => {
      useEvaluationsV3Store
        .getState()
        .setSavedDatasetRecords(
          "saved_dataset-1",
          [{ id: "record-1", image: "/api/files/project-1/object-1/scan.png" }],
          { loadedRows: 1200, totalRows: 10_000 },
        );
    });

    describe("when the workbench shows that dataset", () => {
      /** @scenario "A saved dataset larger than the grid loads says how many rows are shown" */
      it("says how many rows are shown out of how many, and that a run covers them all", () => {
        renderWithDesignSystem(<ActiveDatasetRowsNotice />);

        const notice = screen.getByRole("status");
        expect(notice).toHaveTextContent("Showing the first 1,200 of 10,000 rows");
        expect(notice).toHaveTextContent("A run still covers all 10,000 rows");
      });
    });

    describe("when the grid stores the rows it loaded", () => {
      /** @scenario "The grid remembers that a saved dataset read left rows out" */
      it("keeps the counts on the dataset and leaves them out of the saved experiment", () => {
        const state = useEvaluationsV3Store.getState();

        expect(state.datasets.find((dataset) => dataset.id === "saved_dataset-1")).toMatchObject({
          savedRecordsCut: { loadedRows: 1200, totalRows: 10_000 },
        });
        const persisted = extractPersistedState(state).datasets.find(
          (dataset) => dataset.id === "saved_dataset-1",
        );
        expect(persisted).toBeDefined();
        expect(persisted).not.toHaveProperty("savedRecordsCut");
        expect(persisted).not.toHaveProperty("savedRecords");
      });
    });
  });

  describe("given a saved dataset the grid loaded every row of", () => {
    describe("when the workbench shows that dataset", () => {
      /** @scenario "A saved dataset the grid loads in full shows no rows notice" */
      it("shows no notice", () => {
        useEvaluationsV3Store
          .getState()
          .setSavedDatasetRecords("saved_dataset-1", [{ id: "record-1", image: "" }]);

        renderWithDesignSystem(<ActiveDatasetRowsNotice />);

        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });
    });
  });
});

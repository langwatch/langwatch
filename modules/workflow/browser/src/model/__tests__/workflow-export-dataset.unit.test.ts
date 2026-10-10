/** @see modules/workflow/specs/workflow-service.feature */
import { describe, expect, it } from "vitest";

import { exportedDatasetCutNotice } from "../workflow-export-dataset.ts";

describe("given a workflow exported with its dataset", () => {
  describe("when the dataset was read only in part", () => {
    /** @scenario "Exporting a workflow whose dataset was read in part says so" */
    it("says how many rows the file carries out of how many", () => {
      const notice = exportedDatasetCutNotice({
        truncated: true,
        loadedRows: 1200,
        totalRows: 10_000,
      });

      expect(notice?.description).toContain("first 1,200 of 10,000 rows");
    });
  });

  describe("when every row was read", () => {
    /** @scenario "Exporting a workflow whose dataset was read in part says so" */
    it("says nothing", () => {
      expect(
        exportedDatasetCutNotice({ truncated: false, loadedRows: 3, totalRows: 3 }),
      ).toBeNull();
    });
  });
});

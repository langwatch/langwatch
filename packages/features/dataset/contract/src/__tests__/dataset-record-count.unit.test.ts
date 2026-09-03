/**
 * The display count, over each of the three storage layouts and both names the
 * entries-table count travels under.
 *
 * Spec: specs/datasets/datasets-list-page.feature.
 */
import { describe, expect, it } from "vitest";
import { datasetDisplayRecordCount } from "../dataset-record-count";

describe("datasetDisplayRecordCount", () => {
  describe("given a chunked object-storage dataset", () => {
    it("reads the mirrored row count and never the entries table", () => {
      expect(
        datasetDisplayRecordCount({
          contentLayout: "s3_jsonl",
          rowCount: 4_200,
          recordCount: 0,
          _count: { datasetRecords: 0 },
        }),
      ).toBe(4_200);
    });
  });

  describe("given a legacy single-blob dataset", () => {
    it("reads the stored blob count", () => {
      expect(datasetDisplayRecordCount({ useS3: true, s3RecordCount: 31, recordCount: 0 })).toBe(
        31,
      );
    });
  });

  describe("given a postgres-layout dataset", () => {
    it("reads the included Prisma relation count", () => {
      expect(
        datasetDisplayRecordCount({
          contentLayout: "postgres",
          _count: { datasetRecords: 6 },
        }),
      ).toBe(6);
    });

    /**
     * `listDatasets` projects `_count.datasetRecords` onto `recordCount`, so a
     * row from `dataset.getAll` carries the number under that name only. Before
     * this fallback the datasets list rendered 0 for every such dataset.
     */
    it("reads the summary projection when the relation count did not travel", () => {
      expect(datasetDisplayRecordCount({ contentLayout: "postgres", recordCount: 6 })).toBe(6);
    });

    it("reports zero for a dataset with neither name populated", () => {
      expect(datasetDisplayRecordCount({ contentLayout: "postgres" })).toBe(0);
    });
  });
});

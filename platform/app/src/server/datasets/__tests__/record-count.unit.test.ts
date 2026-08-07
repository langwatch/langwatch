import { describe, expect, it } from "vitest";

import { datasetDisplayRecordCount } from "../record-count";

describe("datasetDisplayRecordCount()", () => {
  describe("given a born-on-storage s3_jsonl dataset", () => {
    it("reports rowCount, not the (empty) DatasetRecord count", () => {
      // The regression: useS3 is false on born datasets, so a useS3-only check
      // fell through to _count.datasetRecords (0) and showed every new dataset
      // as empty.
      expect(
        datasetDisplayRecordCount({
          contentLayout: "s3_jsonl",
          useS3: false,
          rowCount: 1234,
          s3RecordCount: null,
          _count: { datasetRecords: 0 },
        }),
      ).toBe(1234);
    });

    it("falls back to 0 when rowCount is null", () => {
      expect(
        datasetDisplayRecordCount({
          contentLayout: "s3_jsonl",
          rowCount: null,
          _count: { datasetRecords: 0 },
        }),
      ).toBe(0);
    });
  });

  describe("given a legacy single-blob useS3 dataset", () => {
    it("reports s3RecordCount", () => {
      expect(
        datasetDisplayRecordCount({
          contentLayout: "postgres",
          useS3: true,
          s3RecordCount: 42,
          _count: { datasetRecords: 0 },
        }),
      ).toBe(42);
    });
  });

  describe("given a postgres dataset", () => {
    it("reports the DatasetRecord table count", () => {
      expect(
        datasetDisplayRecordCount({
          contentLayout: "postgres",
          useS3: false,
          _count: { datasetRecords: 7 },
        }),
      ).toBe(7);
    });

    it("defaults to 0 when _count is absent", () => {
      expect(datasetDisplayRecordCount({ contentLayout: "postgres" })).toBe(0);
    });
  });
});

/**
 * @vitest-environment node
 * Reading the board's row ids for a run over a pinned dataset version.
 */
import { type DatasetApi, DatasetPageTooLargeError } from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";

import { ExperimentBoardRowsService } from "../experiment-board-rows.service.ts";

const ROW_IDS = ["r1", "r2", "r3", "r4", "r5", "r6"];
const AT = new Date(0);

/** A dataset of `rowIds` whose pages over `maxLimit` rows reaching past `fromRow` are refused. */
const pagedRecords = ({
  rowIds,
  maxLimit,
  fromRow,
}: {
  rowIds: readonly string[];
  maxLimit: number;
  fromRow: number;
}): DatasetApi["listRecords"] => {
  return async ({ page = 1, limit = 50 }) => {
    if (limit > maxLimit && page * limit > fromRow) {
      throw new DatasetPageTooLargeError({ maxBytes: 10, page, limit, suggestedLimit: maxLimit });
    }
    const ids = rowIds.slice((page - 1) * limit, page * limit);
    return {
      data: ids.map((id) => ({
        id,
        datasetId: "ds_1",
        projectId: "project_1",
        entry: {},
        createdAt: AT,
        updatedAt: AT,
      })),
      pagination: {
        page,
        limit,
        total: rowIds.length,
        totalPages: Math.ceil(rowIds.length / limit),
      },
    };
  };
};

describe("given a dataset whose first page of row ids is too large for one response", () => {
  /** @scenario "Board rows are read in smaller pages when a page is too large for one response" */
  it("asks again with the suggested limit and reads every row id once, in order", async () => {
    const calls: [number, number][] = [];
    const at = new Date(0);
    const listRecords: DatasetApi["listRecords"] = async ({ page = 1, limit = 50 }) => {
      calls.push([page, limit]);
      if (limit > 2) {
        throw new DatasetPageTooLargeError({ maxBytes: 10, page, limit, suggestedLimit: 2 });
      }
      const ids = ROW_IDS.slice((page - 1) * limit, page * limit);
      return {
        data: ids.map((id) => ({
          id,
          datasetId: "ds_1",
          projectId: "project_1",
          entry: {},
          createdAt: at,
          updatedAt: at,
        })),
        pagination: {
          page,
          limit,
          total: ROW_IDS.length,
          totalPages: Math.ceil(ROW_IDS.length / limit),
        },
      };
    };
    const service = ExperimentBoardRowsService.create({ datasets: { listRecords } });

    const indices = await service.boardRowIndices({
      projectId: "project_1",
      datasetId: "ds_1",
      runRowIds: ["r6", "gone", "r1"],
    });

    expect(indices).toEqual([5, null, 0]);
    expect(calls).toEqual([
      [1, 1000],
      [1, 2],
      [2, 2],
      [3, 2],
    ]);
  });
});

describe("given a dataset whose later page of row ids is too large for one response", () => {
  /** @scenario "Board rows are read in smaller pages when a page is too large for one response" */
  it("keeps paging at the smaller limit until every row id is read", async () => {
    const rowIds = Array.from({ length: 2500 }, (_, index) => `r${index}`);
    const listRecords = pagedRecords({ rowIds, maxLimit: 250, fromRow: 2000 });
    const service = ExperimentBoardRowsService.create({ datasets: { listRecords } });

    const indices = await service.boardRowIndices({
      projectId: "project_1",
      datasetId: "ds_1",
      runRowIds: ["r2499", "r2000", "r0"],
    });

    expect(indices).toEqual([2499, 2000, 0]);
  });
});

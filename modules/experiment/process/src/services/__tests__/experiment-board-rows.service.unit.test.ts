/**
 * @vitest-environment node
 * Reading the board's row ids for a run over a pinned dataset version.
 */
import { type DatasetApi, DatasetPageTooLargeError } from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";

import { ExperimentBoardRowsService } from "../experiment-board-rows.service.ts";

const ROW_IDS = ["r1", "r2", "r3", "r4", "r5", "r6"];

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

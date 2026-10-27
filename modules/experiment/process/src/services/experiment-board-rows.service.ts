/**
 * Reads the rows the workbench board shows for a saved dataset, its current content, so a run
 * over another version writes its cells onto the rows with the same ids.
 */
import { DATASET_PAGE_LIMIT_MAX, type DatasetApi } from "@langwatch/dataset-contract";

import { boardRowIndicesOf } from "../rules/experiment-board-rows.rules.ts";

export class ExperimentBoardRowsService {
  private constructor(private readonly datasets: Pick<DatasetApi, "listRecords">) {}

  static create({
    datasets,
  }: {
    datasets: Pick<DatasetApi, "listRecords">;
  }): ExperimentBoardRowsService {
    return new ExperimentBoardRowsService(datasets);
  }

  /** The board row of each run row; null for a row the dataset no longer holds. */
  async boardRowIndices({
    projectId,
    datasetId,
    runRowIds,
  }: {
    projectId: string;
    datasetId: string;
    runRowIds: readonly string[];
  }): Promise<(number | null)[]> {
    const boardRowIds: string[] = [];
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page++) {
      const read = await this.datasets.listRecords({
        projectId,
        slugOrId: datasetId,
        page,
        limit: DATASET_PAGE_LIMIT_MAX,
      });
      boardRowIds.push(...read.data.map((record) => record.id));
      totalPages = read.data.length === 0 ? 0 : read.pagination.totalPages;
    }
    return boardRowIndicesOf({ runRowIds, boardRowIds });
  }
}

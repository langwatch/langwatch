/**
 * Reads the rows the workbench board shows for a saved dataset, its current content, so a run
 * over another version writes its cells onto the rows with the same ids.
 */
import {
  DATASET_PAGE_LIMIT_MAX,
  type DatasetApi,
  DatasetPageTooLargeError,
} from "@langwatch/dataset-contract";

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
    let limit = DATASET_PAGE_LIMIT_MAX;
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      let read;
      try {
        read = await this.datasets.listRecords({ projectId, slugOrId: datasetId, page, limit });
      } catch (error) {
        // A page too large for one response names a smaller limit and the page that continues.
        if (!(error instanceof DatasetPageTooLargeError)) throw error;
        const suggestedLimit = Number(error.meta.suggestedLimit);
        if (!(suggestedLimit >= 1 && suggestedLimit < limit)) throw error;
        page = ((page - 1) * limit) / suggestedLimit + 1;
        limit = suggestedLimit;
        continue;
      }
      boardRowIds.push(...read.data.map((record) => record.id));
      totalPages = read.data.length === 0 ? 0 : read.pagination.totalPages;
      page += 1;
    }
    return boardRowIndicesOf({ runRowIds, boardRowIds });
  }
}

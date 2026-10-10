/**
 * What an exported workflow says about the dataset written into it.
 * @see modules/workflow/specs/workflow-service.feature
 */

const rowCount = new Intl.NumberFormat("en-US");

/**
 * The warning for an export whose dataset was read only in part, and nothing
 * for one that carries every row.
 */
export function exportedDatasetCutNotice(read: {
  truncated: boolean;
  loadedRows: number;
  totalRows: number;
}): { title: string; description: string } | null {
  if (!read.truncated) return null;

  return {
    title: "The exported file holds only part of the dataset",
    description: `It carries the first ${rowCount.format(read.loadedRows)} of ${rowCount.format(read.totalRows)} rows, because the dataset is too large to load in full here. Download the dataset as a file to move the rest.`,
  };
}

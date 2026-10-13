/**
 * Which target inputs a run reads as attachments, and for which targets it
 * fetches an outside address itself. @see specs/experiments-v3/attachment-inputs.feature
 */
import type { ExecutionCell } from "@langwatch/experiment-contract";

/** A dataset column as the run sees it. */
export type AttachmentDatasetColumn = { id: string; name: string; type: string };

/**
 * The type an input field reads its value as: the mapped dataset column's
 * type, or for a fixed value or another target's output the target's own
 * declared field type when that is image or file. Anything else stays text.
 */
export const columnTypeOfInputFor =
  ({ cell, datasetColumns }: { cell: ExecutionCell; datasetColumns: AttachmentDatasetColumn[] }) =>
  (inputField: string): string | undefined => {
    const datasetId = cell.datasetEntry._datasetId as string | undefined;
    const mapping = datasetId ? cell.targetConfig.mappings[datasetId]?.[inputField] : undefined;

    if (mapping?.type === "source" && mapping.source === "dataset") {
      return datasetColumns.find((column) => column.name === mapping.sourceField)?.type;
    }

    return pickDeclaredAttachmentFieldType({ cell, inputField });
  };

/** The target's own field type for an input, when it is image or file. */
const pickDeclaredAttachmentFieldType = ({
  cell,
  inputField,
}: {
  cell: ExecutionCell;
  inputField: string;
}): string | undefined => {
  const declared = cell.targetConfig.inputs?.find((field) => field.identifier === inputField)?.type;
  return declared === "image" || declared === "file" ? declared : undefined;
};

/** An agent or workflow runs outside the engine, so the run reads every address for it. */
export const targetReadsExternalAttachments = (cell: ExecutionCell): boolean =>
  cell.targetConfig.type === "agent" || cell.targetConfig.type === "workflow";

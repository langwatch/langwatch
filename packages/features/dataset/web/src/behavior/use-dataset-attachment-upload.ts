/**
 * Storing a file the reader picked in an image or file cell.
 *
 * The table hosts call this once and hand the callback to the shared cells
 * through `DatasetTableContextValue.uploadAttachment`. The cells are elements
 * and cannot reach a transport; this is where the transport is.
 *
 * The callback answers with the stored attachment or throws. The editor
 * renders the failure next to the button that started it and holds its own
 * pending state, so the whole table does not re-render while bytes are on the
 * wire.
 */

import { useCallback } from "react";

import type { DatasetAttachmentUpload } from "../model/dataset-table-context.tsx";
import { readDatasetAttachmentFile } from "../model/dataset-attachment-file.ts";
import { datasetApi } from "./dataset-api.ts";

export function useDatasetAttachmentUpload({
  projectId,
}: {
  projectId: string | undefined;
}): DatasetAttachmentUpload | undefined {
  const { mutateAsync } = datasetApi.datasetRecord.uploadAttachment.useMutation();

  const upload = useCallback<DatasetAttachmentUpload>(
    async ({ file }) => {
      const { fileName, dataUrl } = await readDatasetAttachmentFile(file);
      return await mutateAsync({ projectId: projectId ?? "", fileName, dataUrl });
    },
    [mutateAsync, projectId],
  );

  // No project means no place to store bytes, and the editor offers the URL
  // field alone rather than a button that could only fail.
  return projectId ? upload : void 0;
}

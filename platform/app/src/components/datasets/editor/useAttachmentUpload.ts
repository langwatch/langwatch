/**
 * The upload state of one attachment cell.
 *
 * The cell body only draws; picking a file, sending it and reporting a refusal
 * live here, so the component stays a render of the four states the cell has.
 *
 * @see specs/datasets/dataset-attachment-cells.feature
 */
import { useCallback, useRef, useState } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { uploadDatasetAttachment } from "../services/attachmentUpload";

/**
 * Dataset ids the shared grid passes when it is not backed by a saved dataset
 * (the mapping preview, and an editor over a draft). The upload takes no owner
 * in that case.
 */
const UNSAVED_DATASET_IDS = new Set(["preview", "in-memory"]);

export type AttachmentUpload = {
  /** The hidden file input the cell renders. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** The name of the file being sent, or nothing when the cell is idle. */
  uploadingName: string | null;
  /** The refusal the last upload answered with, or nothing. */
  uploadError: unknown;
  /** Opens the file picker. */
  pickFile: () => void;
  /** Sends the picked file and writes the reference it comes back with. */
  handleFileChosen: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  /** Empties the cell. */
  clear: () => void;
};

export function useAttachmentUpload({
  datasetId,
  onChange,
}: {
  /** The dataset that owns an uploaded file. */
  datasetId: string;
  /** Writes the cell value. */
  onChange: (value: string) => void;
}): AttachmentUpload {
  const { project } = useOrganizationTeamProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<unknown>(null);

  const pickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChosen = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // The same file picked twice in a row must fire the change event again.
      event.target.value = "";
      if (!file || !project?.id) return;

      setUploadError(null);
      setUploadingName(file.name);
      try {
        const attachment = await uploadDatasetAttachment({
          projectId: project.id,
          datasetId: UNSAVED_DATASET_IDS.has(datasetId) ? undefined : datasetId,
          file,
        });
        onChange(attachment.url);
      } catch (error) {
        setUploadError(error);
      } finally {
        setUploadingName(null);
      }
    },
    [datasetId, onChange, project?.id],
  );

  const clear = useCallback(() => {
    setUploadError(null);
    onChange("");
  }, [onChange]);

  return {
    inputRef,
    uploadingName,
    uploadError,
    pickFile,
    handleFileChosen,
    clear,
  };
}

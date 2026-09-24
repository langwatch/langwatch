/**
 * The upload state of one attachment cell: picking a file, sending it and
 * reporting a refusal. @see specs/datasets/dataset-attachment-cells.feature
 */
import { useCallback, useRef, useState } from "react";

import { useDatasetHost } from "../model/dataset-host.ts";
import { uploadDatasetAttachment } from "./attachment-upload.ts";
import { useStoredObjectUploadTransport } from "./use-stored-object-upload.ts";

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
  handleFileChosen: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  /** Empties the cell. */
  clear: () => void;
};

export function useAttachmentUpload({
  onChange,
}: {
  /** Writes the cell value. */
  onChange: (value: string) => void;
}): AttachmentUpload {
  const project = useDatasetHost().project();
  const transport = useStoredObjectUploadTransport();
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
        const reference = await uploadDatasetAttachment({
          projectId: project.id,
          file,
          transport,
        });
        onChange(reference);
      } catch (error) {
        setUploadError(error);
      } finally {
        setUploadingName(null);
      }
    },
    [onChange, project?.id, transport],
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

/**
 * The upload half of the cell editor, for an image or file column.
 *
 * The editor opens on this panel: a button that takes a file from the reader's
 * computer, the value the cell holds today, and a way over to the URL field.
 * The transport arrives through `DatasetTableContextValue.uploadAttachment`,
 * because a cell is an element and never reaches one itself.
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { explainAnyError } from "@langwatch/handled-error/presentation";
import {
  type AttachmentColumnType,
  datasetAttachmentCellValue,
} from "../../model/dataset-attachment-file.ts";
import { useDatasetTable } from "../../model/dataset-table-context.tsx";
import { DatasetCellFile } from "./dataset-cell-file.tsx";

/** What the panel calls the two kinds of file it takes. */
const UPLOAD_LABELS = {
  image: "Upload image",
  file: "Upload file",
} as const satisfies Record<AttachmentColumnType, string>;

/** An image column takes pictures only; a file column takes anything. */
const ACCEPTED_FILES = {
  image: "image/*",
  file: void 0,
} as const satisfies Record<AttachmentColumnType, string | undefined>;

export function DatasetAttachmentPanel({
  dataType,
  value,
  minHeight,
  onUploaded,
  onEnterUrl,
}: {
  dataType: AttachmentColumnType;
  value: string;
  minHeight?: number;
  /** The value the cell should take, once the bytes are stored. */
  onUploaded: (value: string) => void;
  onEnterUrl: () => void;
}) {
  const { renderImage, uploadAttachment } = useDatasetTable();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const pickFile = useCallback(
    async (file: File | undefined) => {
      // Clearing the input is what lets the reader pick the same file again
      // after a failure.
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!file || !uploadAttachment) return;

      setFailure(null);
      setIsUploading(true);
      try {
        const attachment = await uploadAttachment({ file });
        onUploaded(datasetAttachmentCellValue({ dataType, attachment }));
      } catch (error) {
        setFailure(error);
      } finally {
        setIsUploading(false);
      }
    },
    [dataType, onUploaded, uploadAttachment],
  );

  const preview =
    value.length === 0 ? null : dataType === "image" ? (
      renderImage(value)
    ) : (
      <DatasetCellFile value={value} />
    );

  const explained = failure ? explainAnyError(failure) : null;

  return (
    <VStack
      align="stretch"
      gap={2}
      padding={3}
      minHeight={minHeight ? `${minHeight}px` : void 0}
      data-testid="dataset-attachment-panel"
    >
      {preview ? (
        <Box maxHeight="120px" overflow="hidden">
          {preview}
        </Box>
      ) : value.length > 0 ? (
        <Text fontSize="12px" color="fg.muted" lineClamp={2} wordBreak="break-all">
          {value}
        </Text>
      ) : null}

      <HStack gap={3}>
        {uploadAttachment ? (
          <Button
            size="xs"
            colorPalette="orange"
            loading={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={12} /> {UPLOAD_LABELS[dataType]}
          </Button>
        ) : null}
        <Button size="xs" variant="plain" color="fg.muted" onClick={onEnterUrl}>
          or enter a URL
        </Button>
      </HStack>

      {explained ? (
        <Box fontSize="11px" color="red.fg" data-testid="dataset-attachment-error">
          <Text fontWeight="medium">{explained.title}</Text>
          {explained.description ? <Text>{explained.description}</Text> : null}
        </Box>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILES[dataType]}
        style={{ display: "none" }}
        data-testid="dataset-attachment-file-input"
        onChange={(event) => void pickFile(event.target.files?.[0])}
      />
    </VStack>
  );
}

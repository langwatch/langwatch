/**
 * A file in a dataset cell: its name, and a way to open it.
 *
 * A stored file is served from the same origin behind the reader's session, so
 * a plain link is all it takes. Anything the cell holds that names no file at
 * all is drawn as text by the cell instead.
 */

import { HStack, Link, Text } from "@chakra-ui/react";
import { FileText } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { parseDatasetFileCell } from "@langwatch/dataset-contract";
import {
  datasetAttachmentDisplayName,
  datasetAttachmentOpenUrl,
} from "../../model/dataset-attachment-file.ts";

export function DatasetCellFile({ value }: { value: string }) {
  const cell = parseDatasetFileCell(value);
  if (!cell) {
    return null;
  }

  const name = datasetAttachmentDisplayName(value) ?? cell.url;

  return (
    <Link
      href={datasetAttachmentOpenUrl(value) ?? cell.url}
      target="_blank"
      rel="noopener noreferrer"
      // The cell underneath turns a click into a selection and a double click
      // into an edit; opening the file is neither.
      onClick={(event: ReactMouseEvent) => event.stopPropagation()}
      onDoubleClick={(event: ReactMouseEvent) => event.stopPropagation()}
      display="inline-flex"
      maxWidth="100%"
      data-testid="dataset-cell-file"
    >
      <HStack
        gap={1.5}
        minWidth={0}
        maxWidth="100%"
        paddingX={2}
        paddingY={1}
        borderRadius="md"
        borderWidth="1px"
        borderColor="border.emphasized"
        bg="bg.subtle"
      >
        <FileText size={14} />
        <Text truncate fontSize="13px">
          {name}
        </Text>
      </HStack>
    </Link>
  );
}

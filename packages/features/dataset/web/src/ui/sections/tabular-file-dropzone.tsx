/**
 * Drop a CSV, JSON or JSONL file here, and get its rows back.
 *
 * A NARROWED family-local replacement for `CSVReaderComponent`'s parsing path
 * in `platform/app/src/components/datasets/UploadCSVDrawer`, which the upload
 * drawer still renders. What travelled is the one flow the CSV append modal
 * uses: pick or drop a file, parse it in the browser, hand back header-plus-body
 * rows, and offer to remove it again.
 *
 * ONE SUBSTITUTION, deliberate: the platform component drives its dropzone
 * through `react-papaparse`'s `useCSVReader`, which this package does not depend
 * on and which a page move is not the place to add. The surface below is the
 * package's own dropzone chrome — the same one the bulk upload drawer already
 * renders — over a native file input, which is also what makes it reachable and
 * operable by keyboard rather than only by pointer.
 */

import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { formatFileSize, parseTabularFileToRows } from "../../model/parse-tabular-file";
import {
  DROPZONE_DOTTED_STYLE,
  DropzonePrompt,
  dropzoneSurfaceProps,
} from "../elements/dataset-dropzone-styles";

/** Visually hidden but kept in the tab order, so the picker stays operable. */
const SR_ONLY_INPUT: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function TabularFileDropzone({
  onRows,
  onRemoved,
  onParseFailed,
  children,
}: {
  onRows: (rows: string[][]) => void;
  onRemoved?: () => void;
  /** The file could not be read. The caller decides how loudly to say so. */
  onParseFailed: (error: unknown) => void;
  /** Rendered under the zone once a file is in hand — the column mapping. */
  children?: (hasAcceptedFile: boolean) => ReactNode;
}) {
  const [zoneHover, setZoneHover] = useState(false);
  const [accepted, setAccepted] = useState<File | null>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    setAccepted(file);
    parseTabularFileToRows(file)
      .then(onRows)
      .catch((error: unknown) => {
        setAccepted(null);
        onParseFailed(error);
      });
  };

  const remove = () => {
    setAccepted(null);
    onRemoved?.();
  };

  return (
    <>
      {accepted ? (
        <HStack
          width="full"
          padding={3}
          borderWidth="1px"
          borderRadius="lg"
          borderColor="border"
          data-testid="accepted-file"
        >
          <VStack align="start" gap={0} flex={1} minW={0}>
            <Text fontWeight="medium" truncate maxW="full">
              {accepted.name}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {formatFileSize(accepted.size)}
            </Text>
          </VStack>
          <chakra.button
            type="button"
            aria-label="Remove file"
            color="fg.muted"
            display="flex"
            _hover={{ color: "red.500" }}
            onClick={remove}
          >
            <X size={16} />
          </chakra.button>
        </HStack>
      ) : (
        <Box
          as="label"
          {...dropzoneSurfaceProps(zoneHover)}
          style={DROPZONE_DOTTED_STYLE}
          display="block"
          onDragOver={(event: DragEvent) => {
            event.preventDefault();
            setZoneHover(true);
          }}
          onDragLeave={(event: DragEvent) => {
            event.preventDefault();
            setZoneHover(false);
          }}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setZoneHover(false);
            accept(event.dataTransfer?.files?.[0]);
          }}
        >
          <input
            type="file"
            accept=".csv,.json,.jsonl"
            aria-label="Add a file"
            style={SR_ONLY_INPUT}
            onChange={(event) => {
              accept(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <DropzonePrompt />
        </Box>
      )}
      {children ? children(accepted !== null) : null}
    </>
  );
}

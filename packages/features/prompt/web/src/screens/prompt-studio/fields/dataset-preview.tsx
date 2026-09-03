import { Box, Center, HStack, Text } from "@chakra-ui/react";
import type { ComponentProps } from "react";
import { Pencil } from "lucide-react";
import type { DatasetColumns, DatasetRecordInput } from "@langwatch/dataset-contract";
import { DatasetPreviewTable } from "@langwatch/dataset-web";

/**
 * The read-only table a prompt's demonstrations render in.
 *
 * A family-local copy of `platform/app/src/components/datasets/DatasetPreview.tsx`,
 * narrowed twice. The TABLE itself is not copied — `@langwatch/dataset-web`
 * publishes it, and naming that package costs one import line against copying a
 * table the datasets feature owns. What is dropped is the image renderer, whose
 * `ExternalImage` is 279 lines of lightbox with its own escape-key hook, and the
 * error boundary, which read `process.env.NODE_ENV` — a value a browser package
 * may not read. A demonstration cell holding an image URL prints the URL.
 */
export function DatasetPreview({
  rows,
  columns,
  onClick,
  ...props
}: {
  // Accepts input records (optional id) since we're just displaying a preview
  rows: DatasetRecordInput[];
  columns: DatasetColumns;
  onClick?: () => void;
} & Omit<ComponentProps<typeof Box>, "columns" | "rows">) {
  if (!rows) {
    return null;
  }

  return (
    <Box
      width="100%"
      maxHeight="200px"
      overflow="auto"
      borderBottom={rows.length === 0 ? "1px solid rgba(189, 195, 199, 0.58)" : "none"}
      className="dataset-preview"
      position="relative"
      {...props}
    >
      {onClick && (
        <Center
          role="button"
          aria-label="Edit dataset"
          onClick={onClick}
          position="absolute"
          top={0}
          left={0}
          width="100%"
          height="100%"
          background="rgba(0, 0, 0, 0.2)"
          zIndex={10}
          opacity={0}
          cursor="pointer"
          transition="opacity 0.2s ease-in-out"
          _hover={{
            opacity: 1,
          }}
        >
          <HStack
            gap={2}
            fontSize="18px"
            fontWeight="bold"
            color="white"
            background="rgba(0, 0, 0, .5)"
            paddingY={2}
            paddingX={4}
            borderRadius="6px"
          >
            <Pencil size={20} />
            <Text>Edit</Text>
          </HStack>
        </Center>
      )}
      <DatasetPreviewTable rows={rows} columns={columns} />
    </Box>
  );
}

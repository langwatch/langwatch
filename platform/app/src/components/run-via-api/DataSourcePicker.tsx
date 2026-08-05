/**
 * Data-source picker for the Run via API dialog: choose the attached dataset,
 * inline data rows, or a platform dataset id. Drives which body the snippet
 * shows. Rendered under the dialog header as a secondary segmented control.
 */
import { HStack, Text } from "@chakra-ui/react";

import { SegmentedControl } from "~/components/ui/segmented-control";

import type { RunSnippetDataSource } from "./runSnippets";

const ITEMS: Array<{ value: RunSnippetDataSource; label: string }> = [
  { value: "attached", label: "Attached dataset" },
  { value: "inline", label: "Inline data" },
  { value: "dataset_id", label: "Dataset id" },
];

export function DataSourcePicker({
  value,
  onChange,
}: {
  value: RunSnippetDataSource;
  onChange: (value: RunSnippetDataSource) => void;
}) {
  return (
    <HStack gap={2} data-testid="run-via-api-data-source">
      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
        Data source
      </Text>
      <SegmentedControl
        size="xs"
        value={value}
        onValueChange={({ value: next }) => {
          if (next) onChange(next as RunSnippetDataSource);
        }}
        items={ITEMS}
      />
    </HStack>
  );
}

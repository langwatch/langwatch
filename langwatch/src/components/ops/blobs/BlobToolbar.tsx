import { Button, HStack, NativeSelect, Spacer } from "@chakra-ui/react";

import type { OpsBlobSort } from "~/server/app-layer/ops/types";

/**
 * Reader-facing name for each server sort mode.
 *
 * Keyed by {@link OpsBlobSort}, so a mode added server-side fails the build
 * here rather than silently dropping out of the picker.
 */
const SORT_LABELS: Record<OpsBlobSort, string> = {
  largest: "Largest first",
  unreferenced: "Nothing referencing them",
  stalest: "Longest untouched",
  oldest_lapsed_lease: "Longest since a holder stopped",
  scan: "Storage order",
};

/** Ranked modes first: an operator opens this page to find what is occupying the instance. */
const SORT_ORDER: OpsBlobSort[] = [
  "largest",
  "unreferenced",
  "stalest",
  "oldest_lapsed_lease",
  "scan",
];

function isBlobSort(value: string): value is OpsBlobSort {
  return value in SORT_LABELS;
}

export function BlobToolbar({
  queueNames,
  selectedQueue,
  onQueueChange,
  sort,
  onSortChange,
  canManage,
  onPreviewCleanup,
  onRunCleanup,
  previewLoading,
}: {
  queueNames: string[];
  selectedQueue: string | null;
  onQueueChange: (queueName: string) => void;
  sort: OpsBlobSort;
  onSortChange: (sort: OpsBlobSort) => void;
  canManage: boolean;
  onPreviewCleanup: () => void;
  onRunCleanup: () => void;
  previewLoading: boolean;
}) {
  return (
    <HStack marginBottom={4} gap={3}>
      <NativeSelect.Root size="sm" width="260px">
        <NativeSelect.Field
          aria-label="Queue"
          value={selectedQueue ?? ""}
          onChange={(e) => onQueueChange(e.currentTarget.value)}
        >
          {queueNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>

      <NativeSelect.Root size="sm" width="280px">
        <NativeSelect.Field
          aria-label="Order"
          value={sort}
          onChange={(e) => {
            const next = e.currentTarget.value;
            if (isBlobSort(next)) onSortChange(next);
          }}
        >
          {SORT_ORDER.map((value) => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>

      <Spacer />

      {canManage && (
        <>
          <Button
            size="2xs"
            variant="outline"
            loading={previewLoading}
            onClick={onPreviewCleanup}
          >
            Preview cleanup
          </Button>
          <Button
            size="2xs"
            variant="outline"
            colorPalette="red"
            onClick={onRunCleanup}
          >
            Run cleanup
          </Button>
        </>
      )}
    </HStack>
  );
}

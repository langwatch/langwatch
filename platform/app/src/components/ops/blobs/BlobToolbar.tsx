import { Button, HStack, Spacer } from "@chakra-ui/react";

import type { OpsBlobSort } from "~/server/app-layer/ops/types";

import { BlobFilters } from "./BlobFilters";

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
      <BlobFilters
        queueNames={queueNames}
        selectedQueue={selectedQueue}
        onQueueChange={onQueueChange}
        sort={sort}
        onSortChange={onSortChange}
      />
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

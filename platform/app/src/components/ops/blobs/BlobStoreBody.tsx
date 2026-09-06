import { Button, Center, EmptyState, Flex, Spinner } from "@chakra-ui/react";
import { Database } from "lucide-react";

import type { OpsBlobSummary } from "~/server/app-layer/ops/types";

import { BlobTable } from "./BlobTable";

export function BlobStoreBody({
  isLoading,
  blobs,
  canManage,
  onDelete,
  hasMore,
  onLoadMore,
  isLoadingMore,
}: {
  isLoading: boolean;
  blobs: OpsBlobSummary[];
  canManage: boolean;
  onDelete: (blob: OpsBlobSummary) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
}) {
  if (isLoading) {
    return (
      <Center paddingY={20}>
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <Spinner size="lg" />
            </EmptyState.Indicator>
            <EmptyState.Title>Loading payloads</EmptyState.Title>
          </EmptyState.Content>
        </EmptyState.Root>
      </Center>
    );
  }

  if (blobs.length === 0) {
    return (
      <Center paddingY={20}>
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <Database />
            </EmptyState.Indicator>
            <EmptyState.Title>No stored payloads</EmptyState.Title>
            <EmptyState.Description>
              Nothing is being held for this queue.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      </Center>
    );
  }

  return (
    <>
      <BlobTable blobs={blobs} canManage={canManage} onDelete={onDelete} />
      {hasMore && (
        <Flex justify="center" paddingY={4}>
          <Button
            size="sm"
            variant="outline"
            loading={isLoadingMore}
            onClick={onLoadMore}
          >
            Load more
          </Button>
        </Flex>
      )}
    </>
  );
}

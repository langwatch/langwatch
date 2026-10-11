/** The one "Load more" for an appending list: a count, then the button until the end. */
import { Button, Text, VStack } from "@chakra-ui/react";

export interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** With `total`: "Showing 50 of 212 runs". */
  shown?: number;
  total?: number;
  /** Plural noun: "runs". */
  unitLabel?: string;
  "data-testid"?: string;
}

export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  shown,
  total,
  unitLabel,
  "data-testid": testId,
}: LoadMoreProps) {
  const count = describeCount({ shown, total, unitLabel });
  if (!hasMore && count === undefined) return null;
  return (
    <VStack gap={2} paddingY={3} data-testid={testId}>
      {count && (
        <Text as="output" textStyle="xs" color="fg.muted">
          {count}
        </Text>
      )}
      {hasMore && (
        <Button type="button" variant="outline" size="sm" loading={loading} onClick={onLoadMore}>
          Load more
        </Button>
      )}
    </VStack>
  );
}

function describeCount({
  shown,
  total,
  unitLabel,
}: Pick<LoadMoreProps, "shown" | "total" | "unitLabel">): string | undefined {
  if (shown === undefined) return undefined;
  const unit = unitLabel ? ` ${unitLabel}` : "";
  if (total === undefined) return `Showing ${shown}${unit}`;
  return `Showing ${shown} of ${total}${unit}`;
}

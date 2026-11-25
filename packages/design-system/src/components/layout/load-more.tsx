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
  /** The button's visible text. Default "Load more". */
  label?: string;
  /** Defaults to the visible label. */
  "aria-label"?: string;
  /** `compact`: a full-width xs ghost button in fg.muted; the parent keeps the inset. */
  appearance?: "default" | "compact";
  "data-testid"?: string;
}

export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  shown,
  total,
  unitLabel,
  label = "Load more",
  "aria-label": ariaLabel,
  appearance = "default",
  "data-testid": testId,
}: LoadMoreProps) {
  const count = describeCount({ shown, total, unitLabel });
  if (!hasMore && count === undefined) return null;
  const compact = appearance === "compact";
  return (
    <VStack
      gap={2}
      paddingY={compact ? 2 : 3}
      align={compact ? "stretch" : undefined}
      data-testid={testId}
    >
      {count && (
        <Text as="output" textStyle="xs" color="fg.muted">
          {count}
        </Text>
      )}
      {hasMore && (
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "xs" : "sm"}
          width={compact ? "full" : undefined}
          color={compact ? "fg.muted" : undefined}
          aria-label={ariaLabel ?? label}
          loading={loading}
          onClick={() => {
            if (!loading) onLoadMore();
          }}
        >
          {label}
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

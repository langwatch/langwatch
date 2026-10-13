/**
 * Loading placeholders shaped like what is coming, in place of a content Spinner: the
 * layout holds still when the data lands. A Spinner stays right inside a busy button.
 */
import {
  Box,
  Card,
  HStack,
  Skeleton,
  SkeletonText,
  VStack,
  VisuallyHidden,
} from "@chakra-ui/react";

/** A list's rows while it loads: one bar per row, with an optional leading avatar or icon. */
export function SkeletonRows({
  rows = 5,
  leading = false,
  label = "Loading",
}: {
  rows?: number;
  /** A square before each row, for lists that start with an icon or avatar. */
  leading?: boolean;
  /** What a screen reader hears. */
  label?: string;
}) {
  return (
    <VStack align="stretch" gap={0} width="full" aria-busy="true" data-testid="skeleton-rows">
      <VisuallyHidden>{label}</VisuallyHidden>
      {Array.from({ length: rows }, (_, row) => (
        <HStack
          key={row}
          aria-hidden
          gap={3}
          paddingY={2.5}
          borderBottomWidth={row === rows - 1 ? 0 : "1px"}
          borderColor="border.muted"
        >
          {leading && <Skeleton boxSize="6" borderRadius="sm" flexShrink={0} />}
          <Skeleton height="12px" width={row % 2 === 0 ? "55%" : "40%"} />
          <Box flex={1} />
          <Skeleton height="12px" width="64px" />
        </HStack>
      ))}
    </VStack>
  );
}

/** A card's body while it loads: a title bar and `lines` of text, in the card look. */
export function SkeletonCard({
  lines = 3,
  title = true,
  label = "Loading",
}: {
  lines?: number;
  title?: boolean;
  label?: string;
}) {
  return (
    <Card.Root width="full" bg="bg.card" borderColor="border.card" aria-busy="true">
      <Card.Body paddingX={4} paddingY={3.5}>
        <VisuallyHidden>{label}</VisuallyHidden>
        <VStack align="stretch" gap={3} aria-hidden>
          {title && <Skeleton height="14px" width="40%" />}
          <SkeletonText noOfLines={lines} gap={2} />
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

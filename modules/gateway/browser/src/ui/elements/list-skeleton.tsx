/** A list still loading, drawn in the shape it will take: one bordered card of rows. */
import { Card, Skeleton, SkeletonText, VStack } from "@langwatch/design-system/primitives";

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card.Root width="full" data-testid="gateway-list-skeleton">
      <Card.Body>
        <VStack align="stretch" gap={5}>
          <Skeleton height="16px" width="40%" />
          {Array.from({ length: rows }, (_, index) => (
            <SkeletonText key={index} noOfLines={2} gap={2} />
          ))}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** A list still loading, drawn in the shape it will take: one bordered card of rows. */
import { Card } from "@langwatch/design-system/card";
import { Skeleton, SkeletonText, VStack } from "@langwatch/design-system/primitives";

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card variant="showcase" padding="lg" data-testid="gateway-list-skeleton">
      <VStack align="stretch" gap={5}>
        <Skeleton height="16px" width="40%" />
        {Array.from({ length: rows }, (_, index) => (
          <SkeletonText key={index} noOfLines={2} gap={2} />
        ))}
      </VStack>
    </Card>
  );
}

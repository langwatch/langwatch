import { HStack, Skeleton, VStack } from "@chakra-ui/react";

/**
 * A list of rows before its data lands, in the real row's geometry (a mark, a
 * name over a quieter line, a control at the end) so nothing jumps on arrival.
 */
export function SettingsRowsSkeleton({
  rows = 3,
  "data-testid": testId = "settings-rows-skeleton",
}: {
  /** How many rows this section usually holds. */
  rows?: number;
  "data-testid"?: string;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      width="full"
      data-testid={testId}
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading"
    >
      {Array.from({ length: rows }, (_, index) => (
        <HStack key={index} gap={3} width="full" paddingY={2.5}>
          <Skeleton height="20px" width="20px" borderRadius="sm" flexShrink={0} />
          <VStack align="start" gap={0.5} flex={1} minWidth={0}>
            {/* Uneven widths, so the column reads as rows of names rather than a loading bar. */}
            <Skeleton height="12px" width={index % 2 === 0 ? "38%" : "30%"} />
            <Skeleton height="10px" width={index % 2 === 0 ? "56%" : "64%"} />
          </VStack>
          <Skeleton height="24px" width="72px" borderRadius="md" flexShrink={0} />
        </HStack>
      ))}
    </VStack>
  );
}

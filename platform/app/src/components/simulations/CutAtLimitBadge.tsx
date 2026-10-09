import { Text } from "@chakra-ui/react";

/**
 * The "Cut at the call limit" marker (AC28). A single presentational badge so
 * every run header reads the same and stays in one place.
 */
export function CutAtLimitBadge() {
  return (
    <Text
      fontSize="xs"
      fontWeight="medium"
      color="fg.muted"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      px={2}
      py={0.5}
    >
      Cut at the call limit
    </Text>
  );
}

/**
 * Whether a run's metadata says LangWatch ended the call at the limit (AC28).
 * The one place that reads the raw `langwatch.isCutAtLimit` flag, so every
 * caller derives the same boolean from the loose metadata shape.
 */
export function isCutAtLimitOf(metadata: unknown): boolean {
  return (
    (metadata as { langwatch?: { isCutAtLimit?: unknown } } | null | undefined)
      ?.langwatch?.isCutAtLimit === true
  );
}

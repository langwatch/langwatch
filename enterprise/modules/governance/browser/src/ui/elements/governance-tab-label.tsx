/** A tab's name with the count of what sits behind it, once that count is known. */
import { Badge, HStack, Text } from "@langwatch/design-system/primitives";

export function GovernanceTabLabel({ label, count }: { label: string; count?: number | null }) {
  return (
    <HStack gap={2}>
      <Text as="span">{label}</Text>
      {count !== undefined && count !== null && (
        <Badge size="sm" variant="surface" colorPalette="gray">
          {count}
        </Badge>
      )}
    </HStack>
  );
}

import { SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";

/**
 * A labeled group of PII identifier checkboxes for the custom level. One group
 * for the natively-detected identifiers and one for the ones that need the
 * analysis service, so the customer sees the cost trade-off of each selection.
 */
export function PiiEntityToggleGroup({
  title,
  hint,
  labels,
  selected,
  onToggle,
}: {
  title: string;
  hint: string;
  labels: Record<string, string>;
  selected: string[];
  onToggle: (entity: string) => void;
}) {
  const selectedSet = new Set(selected);
  return (
    <VStack align="stretch" gap={1.5}>
      <VStack align="start" gap={0}>
        <Text fontWeight="600" fontSize="xs">
          {title}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      </VStack>
      <SimpleGrid columns={2} gap={1} columnGap={4}>
        {Object.entries(labels).map(([entity, label]) => (
          <Checkbox
            key={entity}
            size="sm"
            checked={selectedSet.has(entity)}
            onCheckedChange={() => onToggle(entity)}
          >
            <Text fontSize="xs">{label}</Text>
          </Checkbox>
        ))}
      </SimpleGrid>
    </VStack>
  );
}

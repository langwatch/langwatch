import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Tag } from "lucide-react";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Checkbox } from "~/components/ui/checkbox";

type LabelFilterDropdownProps = {
  allLabels: string[];
  activeLabels: string[];
  onToggle: (label: string) => void;
};

/**
 * Dropdown for filtering scenarios by labels.
 */
export function LabelFilterDropdown({
  allLabels,
  activeLabels,
  onToggle,
}: LabelFilterDropdownProps) {
  const hasActiveFilters = activeLabels.length > 0;

  return (
    <PopoverRoot positioning={{ placement: "bottom-start" }}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={hasActiveFilters ? "solid" : "outline"}
          colorPalette={hasActiveFilters ? "blue" : "gray"}
        >
          <Tag size={14} />
          Labels
          {hasActiveFilters && (
            <Text as="span" fontSize="xs" ml={1}>
              ({activeLabels.length})
            </Text>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent width="200px">
        <PopoverBody>
          {allLabels.length === 0 ? (
            <Text fontSize="sm" color="gray.500">
              No labels available
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {allLabels.map((label) => (
                <HStack
                  key={label}
                  cursor="pointer"
                  onClick={() => onToggle(label)}
                >
                  <Checkbox
                    checked={activeLabels.includes(label)}
                    onCheckedChange={() => onToggle(label)}
                  />
                  <Text fontSize="sm">#{label}</Text>
                </HStack>
              ))}
            </VStack>
          )}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}





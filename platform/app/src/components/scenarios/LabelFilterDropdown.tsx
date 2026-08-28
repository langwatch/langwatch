import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Tag } from "lucide-react";
import { SmallButton } from "~/components/agent-testing/shared/SmallButton";
import { Checkbox } from "~/components/ui/checkbox";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { pastelSwatchColor } from "~/components/ui/TagPill";

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
        <SmallButton>
          <Tag size={13} />
          Labels
          {hasActiveFilters && (
            <Text as="span" fontSize="12px" ml={1}>
              ({activeLabels.length})
            </Text>
          )}
        </SmallButton>
      </PopoverTrigger>
      <PopoverContent width="220px">
        <PopoverBody>
          {allLabels.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No labels available
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {allLabels.map((label) => {
                const swatch = pastelSwatchColor(label);
                return (
                  <HStack
                    key={label}
                    cursor="pointer"
                    onClick={() => onToggle(label)}
                    gap={2}
                  >
                    <Checkbox checked={activeLabels.includes(label)} />
                    <Box
                      width="10px"
                      height="10px"
                      borderRadius="full"
                      bg={swatch}
                      flexShrink={0}
                    />
                    <Text fontSize="sm">{label}</Text>
                  </HStack>
                );
              })}
            </VStack>
          )}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

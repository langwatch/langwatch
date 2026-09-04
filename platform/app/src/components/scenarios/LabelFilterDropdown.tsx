import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
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
  /**
   * "header" draws the trigger at the page-header button size, matching the
   * PageLayout.HeaderButton beside it. Unset keeps the Agent Testing small
   * button, which is what the cases panel wants.
   */
  triggerSize?: "header";
};

/**
 * Dropdown for filtering scenarios by labels.
 */
export function LabelFilterDropdown({
  allLabels,
  activeLabels,
  onToggle,
  triggerSize,
}: LabelFilterDropdownProps) {
  const hasActiveFilters = activeLabels.length > 0;

  const triggerContent = (
    <>
      <Tag size={triggerSize === "header" ? 16 : 13} />
      Labels
      {hasActiveFilters && (
        <Text as="span" fontSize="12px" ml={1}>
          ({activeLabels.length})
        </Text>
      )}
    </>
  );

  return (
    <PopoverRoot positioning={{ placement: "bottom-start" }}>
      <PopoverTrigger asChild>
        {triggerSize === "header" ? (
          <Button variant="outline" size="sm">
            {triggerContent}
          </Button>
        ) : (
          <SmallButton>{triggerContent}</SmallButton>
        )}
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

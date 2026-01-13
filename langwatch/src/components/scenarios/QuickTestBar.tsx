import { HStack, Text } from "@chakra-ui/react";
import { TargetSelector, type TargetValue } from "./TargetSelector";

interface QuickTestBarProps {
  value: TargetValue;
  onChange: (value: TargetValue) => void;
  onCreateAgent?: () => void;
}

/**
 * Quick Test section in the scenario editor footer.
 * Uses unified TargetSelector for selecting prompts or HTTP agents.
 */
export function QuickTestBar({
  value,
  onChange,
  onCreateAgent,
}: QuickTestBarProps) {
  return (
    <HStack gap={4}>
      <Text
        fontSize="xs"
        fontWeight="bold"
        textTransform="uppercase"
        color="gray.500"
      >
        Run Against
      </Text>
      <TargetSelector
        value={value}
        onChange={onChange}
        onCreateAgent={onCreateAgent}
      />
    </HStack>
  );
}

import { HStack, Text } from "@chakra-ui/react";
import { PromptSelector } from "./PromptSelector";
import { HttpAgentSelector } from "./HttpAgentSelector";
import { TargetTypeSelector, type TargetType } from "./TargetTypeSelector";

interface QuickTestBarProps {
  targetType: TargetType;
  onTargetTypeChange: (type: TargetType) => void;
  selectedTargetId: string | null;
  onTargetIdChange: (value: string | null) => void;
}

/**
 * Quick Test section in the scenario editor footer.
 * Allows selecting a target type (prompt or HTTP agent) and the specific target.
 */
export function QuickTestBar({
  targetType,
  onTargetTypeChange,
  selectedTargetId,
  onTargetIdChange,
}: QuickTestBarProps) {
  return (
    <HStack gap={4}>
      <Text
        fontSize="xs"
        fontWeight="bold"
        textTransform="uppercase"
        color="gray.500"
      >
        Quick Test
      </Text>
      <HStack gap={2}>
        <TargetTypeSelector value={targetType} onChange={onTargetTypeChange} />
        {targetType === "prompt" ? (
          <PromptSelector value={selectedTargetId} onChange={onTargetIdChange} />
        ) : (
          <HttpAgentSelector
            value={selectedTargetId}
            onChange={onTargetIdChange}
          />
        )}
      </HStack>
    </HStack>
  );
}

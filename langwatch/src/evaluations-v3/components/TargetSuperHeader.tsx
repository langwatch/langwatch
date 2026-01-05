import { Button, Skeleton, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import { LLMIcon } from "~/components/icons/LLMIcon";
import { PulsingDot } from "./PulsingDot";
import { SuperHeader } from "./SuperHeader";

type TargetSuperHeaderProps = {
  colSpan: number;
  onAddClick?: () => void;
  showWarning?: boolean;
  hasComparison?: boolean;
  isLoading?: boolean;
};

/**
 * Super header for the targets (prompts/agents) columns section.
 */
export function TargetSuperHeader({
  colSpan,
  onAddClick,
  showWarning,
  hasComparison,
  isLoading,
}: TargetSuperHeaderProps) {
  const addButtonText = hasComparison ? "Add Comparison" : "Add";

  return (
    <SuperHeader colSpan={colSpan} color="green.400" icon={<LLMIcon />}>
      {isLoading ? (
        <>
          <Text fontWeight="semibold" fontSize="sm" color="gray.700">
            Prompts or Agents
          </Text>
          <Skeleton height="20px" width="150px" />
        </>
      ) : (
        <Text fontWeight="semibold" fontSize="sm" color="gray.700">
          Prompts or Agents
        </Text>
      )}
      {!isLoading && onAddClick && (
        <Button
          size="xs"
          variant="ghost"
          onClick={onAddClick}
          color="gray.500"
          _hover={{ color: "gray.700" }}
        >
          <Plus size={12} />
          {addButtonText}
          {showWarning && <PulsingDot />}
        </Button>
      )}
    </SuperHeader>
  );
}


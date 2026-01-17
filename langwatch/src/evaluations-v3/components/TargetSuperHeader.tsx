import { Skeleton, Text } from "@chakra-ui/react";

import { LLMIcon } from "~/components/icons/LLMIcon";
import { SuperHeader } from "./SuperHeader";

type TargetSuperHeaderProps = {
  colSpan: number;
  isLoading?: boolean;
};

/**
 * Super header for the targets (prompts/agents) columns section.
 * The "Add" button has been moved to the spacer column (AddTargetColumn).
 */
export function TargetSuperHeader({
  colSpan,
  isLoading,
}: TargetSuperHeaderProps) {
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
    </SuperHeader>
  );
}

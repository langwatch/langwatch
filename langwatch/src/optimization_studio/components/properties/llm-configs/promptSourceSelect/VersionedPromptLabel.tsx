import { HStack, Text } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";

import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";

import { VersionBadge } from "./VersionBadge";

/**
 * Label for the versioned prompt in the optimization studio
 */
export function VersionedPromptLabel({
  node,
}: {
  node: Node<LlmPromptConfigComponent>;
}) {
  return (
    <HStack gap={1} alignItems="center" flexWrap="nowrap">
      <Text>Versioned Prompt</Text>
      <VersionBadge node={node} />
    </HStack>
  );
}

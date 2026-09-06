import { HStack, Text } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";

import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import { VersionBadge } from "~/prompts/components/ui/VersionBadge";

import { useResetFormWithLatestDatabaseVersion } from "../signature-properties-panel/hooks/useResetFormWithLatestDatabaseVersion";
import { useVersionDrift } from "../signature-properties-panel/hooks/useVersionDrift";

/**
 * Label for the versioned prompt in the optimization studio
 */
export function VersionedPromptLabel({
  node,
}: {
  node: Node<LlmPromptConfigComponent>;
}) {
  const { latestPromptVersion, nodeVersion } = useVersionDrift(node);
  const configId = node.data.configId;
  const { resetFormWithLatestVersion } = useResetFormWithLatestDatabaseVersion({
    configId,
  });

  // Older nodes don't have a version number
  if (typeof node.data.versionMetadata?.versionNumber !== "number") {
    return (
      <HStack gap={1} alignItems="center" flexWrap="nowrap">
        <Text>Versioned Prompt</Text>
      </HStack>
    );
  }

  return (
    <HStack gap={1} alignItems="center" flexWrap="nowrap">
      <Text>Versioned Prompt</Text>
      <VersionBadge
        version={nodeVersion ?? 0}
        latestVersion={latestPromptVersion}
        onUpgrade={() => void resetFormWithLatestVersion()}
      />
    </HStack>
  );
}

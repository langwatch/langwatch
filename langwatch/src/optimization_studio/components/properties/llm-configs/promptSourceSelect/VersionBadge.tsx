import { Badge, HStack, Text } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";

import { Tooltip } from "~/components/ui/tooltip";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";

import { useResetFormWithLatestDatabaseVersion } from "../signature-properties-panel/hooks/useResetFormWithLatestDatabaseVersion";
import { useVersionDrift } from "../signature-properties-panel/hooks/useVersionDrift";

/**
 * Detects drift between optimization studio node data and database version.
 * Shows a visual indicator and provides option to load latest version when drift is detected.
 */
export function VersionBadge({
  node,
}: {
  node: Node<LlmPromptConfigComponent>;
}) {
  const { latestPromptVersion, nodeVersion, isOutdated } =
    useVersionDrift(node);
  const configId = node.data.configId;
  const { resetFormWithLatestVersion } = useResetFormWithLatestDatabaseVersion({
    configId,
  });
  // Older nodes don't have a version number
  if (typeof node.data.versionMetadata?.versionNumber !== "number") {
    return null;
  }

  // Show a tooltip and update button if there is drift
  if (isOutdated) {
    return (
      <Tooltip
        content="This prompt is outdated, click to update to latest version"
        positioning={{ placement: "top" }}
        showArrow
      >
        <HStack
          gap={1}
          fontSize="sm"
          flexWrap="nowrap"
          onClick={() => void resetFormWithLatestVersion()}
          cursor="pointer"
        >
          <Badge colorPalette="gray" textTransform="none">
            v{nodeVersion ?? "?"}
          </Badge>
          <Text>→</Text>
          <Badge colorPalette="green" textTransform="none">
            v{latestPromptVersion}
          </Badge>
        </HStack>
      </Tooltip>
    );
  }

  // Show the version number if there is no drift
  return (
    <Badge colorPalette="gray" textTransform="none">
      v{nodeVersion}
    </Badge>
  );
}

import type { Node } from "@xyflow/react";
import type { Custom } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

import { Avatar, Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { ExternalLink } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { Link } from "../../../components/ui/link";
import { toaster } from "../../../components/ui/toaster";
import { useComponentVersion } from "../../hooks/useComponentVersion";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";

import { formatTimeAgo } from "../../../utils/formatTimeAgo";
import type { Workflow } from "../../types/dsl";
import { getInputsOutputs } from "../../utils/nodeUtils";
import { VersionBox } from "../History";

export function CustomPropertiesPanel({ node }: { node: Node<Custom> }) {
  return (
    <BasePropertiesPanel
      node={node}
      hideParameters
      inputsReadOnly
      outputsReadOnly
    >
      <CustomComponentInfo node={node} />
    </BasePropertiesPanel>
  );
}

const CustomComponentInfo = ({ node }: { node: Node<Custom> }) => {
  const { currentVersion, publishedVersion } = useComponentVersion(node);
  const { project } = useOrganizationTeamProject();
  const { setNode, deselectAllNodes } = useWorkflowStore(
    useShallow(({ setNode, deselectAllNodes }) => ({
      setNode,
      deselectAllNodes,
    }))
  );
  const updateNodeInternals = useUpdateNodeInternals();

  const updateToLatestVersion = () => {
    const { inputs, outputs } = getInputsOutputs(
      (publishedVersion?.dsl as unknown as Workflow).edges,
      (publishedVersion?.dsl as unknown as Workflow).nodes
    );

    setNode({
      id: node.id,
      data: { inputs, outputs, version_id: publishedVersion?.id },
    });

    updateNodeInternals(node.id);

    deselectAllNodes();

    toaster.create({
      title: "Updated to latest version",
      type: "success",
      duration: 3000,
    });
  };

  return (
    <HStack width="full" gap={3}>
      {currentVersion && (
        <VersionBox version={currentVersion} minWidth="44px" />
      )}
      <VStack align="start" width="full" gap={1}>
        <HStack>
          <Text fontWeight={600} fontSize="13px" lineClamp={1}>
            {currentVersion?.commitMessage}
          </Text>
          <Link
            href={`/${project?.slug}/studio/${node.data.workflow_id}`}
            isExternal
          >
            <ExternalLink size={14} />
          </Link>
          {currentVersion?.isPublishedVersion ? (
            <Badge colorPalette="green" size="sm" paddingX={2}>
              Latest version
            </Badge>
          ) : (
            <Button
              size="xs"
              variant="outline"
              colorPalette="gray"
              onClick={() => {
                updateToLatestVersion();
              }}
            >
              Update to latest version
            </Button>
          )}
        </HStack>
        <HStack>
          <Avatar.Root size="2xs">
            <Avatar.Fallback name="jim" bg="orange.400" color="white" />
          </Avatar.Root>
          <Text fontSize="12px" lineClamp={1}>
            {currentVersion?.author?.name}
          </Text>
          <Text fontSize="12px" flexShrink={0}>
            ·
          </Text>
          <Text fontSize="12px" flexShrink={0}>
            {currentVersion?.updatedAt &&
              formatTimeAgo(currentVersion.updatedAt.getTime())}
          </Text>
        </HStack>
      </VStack>
    </HStack>
  );
};

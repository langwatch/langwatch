import type { Node, NodeProps } from "@xyflow/react";
import type { Component, Custom } from "../../types/dsl";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

import {
  Avatar,
  Button,
  HStack,
  Link,
  Tag,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { ExternalLink } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
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
  const toast = useToast();
  const { setNode, setSelectedNode, setPropertiesExpanded, deselectAllNodes } =
    useWorkflowStore(
      useShallow(
        ({
          setNode,
          setSelectedNode,
          setPropertiesExpanded,
          deselectAllNodes,
        }) => ({
          setNode,
          setSelectedNode,
          setPropertiesExpanded,
          deselectAllNodes,
        })
      )
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

    toast({
      title: "Updated to latest version",
      status: "success",
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
          <Text fontWeight={600} fontSize="13px" noOfLines={1}>
            {currentVersion?.commitMessage}
          </Text>
          <Link
            href={`/${project?.slug}/studio/${node.data.workflow_id}`}
            isExternal
          >
            <ExternalLink size={14} />
          </Link>
          {currentVersion?.isPublishedVersion ? (
            <Tag colorPalette="green" size="sm" paddingX={2}>
              Latest version
            </Tag>
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
          <Avatar
            name={"jim"}
            backgroundColor={"orange.400"}
            color="white"
            size="2xs"
          />
          <Text fontSize="12px" noOfLines={1}>
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

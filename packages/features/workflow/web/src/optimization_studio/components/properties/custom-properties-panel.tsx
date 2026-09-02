import { Avatar, Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { ExternalLink } from "react-feather";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../../studio-host/use-organization-team-project";
import { Link } from "../../../studio-host/link";
import { toaster } from "../../../studio-host/toaster";
import { formatTimeAgo } from "../../../utils/format-time-ago";
import { useComponentVersion } from "../../hooks/use-component-version";
import { useWorkflowStore } from "@langwatch/workflow-web";
import {
  getInputsOutputs,
  parseStudioWorkflow,
  type Custom,
} from "@langwatch/workflow-contract";
import { VersionBox } from "../history";
import { BasePropertiesPanel } from "./base-properties-panel";

export function CustomPropertiesPanel({ node }: { node: Node<Custom> }) {
  return (
    <BasePropertiesPanel node={node} hideParameters inputsReadOnly outputsReadOnly>
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
    })),
  );
  const updateNodeInternals = useUpdateNodeInternals();

  const updateToLatestVersion = () => {
    if (!publishedVersion?.dsl) return;
    const workflow = parseStudioWorkflow(publishedVersion.dsl);
    const { inputs, outputs } = getInputsOutputs(workflow.edges, workflow.nodes);

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
      {currentVersion && <VersionBox version={currentVersion} minWidth="44px" />}
      <VStack align="start" width="full" gap={1}>
        <HStack>
          <Text fontWeight={600} fontSize="13px" lineClamp={1}>
            {currentVersion?.commitMessage}
          </Text>
          <Link href={`/${project?.slug}/studio/${node.data.workflow_id}`} isExternal>
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

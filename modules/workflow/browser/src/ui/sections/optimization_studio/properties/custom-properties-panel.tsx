import { Badge, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Link } from "@langwatch/browser-host/link";
import { toaster } from "@langwatch/browser-host/toaster";
import { Avatar } from "@langwatch/design-system/avatar";
import { toEpochMs } from "@langwatch/time";
import { getInputsOutputs, parseStudioWorkflow, type Custom } from "@langwatch/workflow-contract";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { ExternalLink } from "react-feather";
import { useShallow } from "zustand/react/shallow";

import { useComponentVersion } from "../../../../behavior/optimization_studio/use-component-version.tsx";
import { useOrganizationTeamProject } from "../../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../../behavior/use-workflow-store.ts";
import { VersionBox } from "../history.tsx";
import { BasePropertiesPanel } from "./base-properties-panel.tsx";

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
            {currentVersion?.updatedAt && formatTimeAgo(toEpochMs(currentVersion.updatedAt))}
          </Text>
        </HStack>
      </VStack>
    </HStack>
  );
};

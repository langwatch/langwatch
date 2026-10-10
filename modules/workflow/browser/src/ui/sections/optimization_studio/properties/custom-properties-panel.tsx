import { Link } from "@langwatch/browser-host/link";
import { toaster } from "@langwatch/browser-host/toaster";
import { Avatar } from "@langwatch/design-system/avatar";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { toEpochMs } from "@langwatch/time";
import { getInputsOutputs, parseStudioWorkflow, type Custom } from "@langwatch/workflow-contract";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { ExternalLink } from "lucide-react";
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
          <Text textStyle="cardTitle" lineClamp={1}>
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
            <Avatar.Fallback name="jim" bg="orange.solid" color="orange.contrast" />
          </Avatar.Root>
          <Text textStyle="caption" lineClamp={1}>
            {currentVersion?.author?.name}
          </Text>
          <Text textStyle="caption" flexShrink={0}>
            ·
          </Text>
          <Text textStyle="caption" flexShrink={0}>
            {currentVersion?.updatedAt && (
              <FormattedDate value={toEpochMs(currentVersion.updatedAt)} display="auto" />
            )}
          </Text>
        </HStack>
      </VStack>
    </HStack>
  );
};

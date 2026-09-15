/**
 * The standalone chat address for a published workflow. Has no chrome —
 * paints the product mark and one card full-height. No `isClient`/SSR
 * gate, since this app never renders on a server.
 */

import { Box, Card as ChakraCard } from "@chakra-ui/react";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";
import type { Edge, Node } from "@xyflow/react";

import { workflowApi } from "../../model/workflow-api.ts";
import { useWorkflowHost } from "../../model/workflow-host.ts";
import { FullLogo } from "@langwatch/design-system/full-logo";
import { LoadingScreen } from "@langwatch/design-system/loading-screen";
import { WorkflowChatBox } from "../../ui/sections/workflow-chat-box.tsx";

export default function WorkflowChatScreen() {
  const host = useWorkflowHost();
  const { projectId } = host.scope();
  const workflowId = host.route().params.workflow ?? "";

  const publishedWorkflow = workflowApi.optimization.getPublishedWorkflow.useQuery(
    { workflowId, projectId: projectId ?? "" },
    { enabled: !!projectId && !!workflowId },
  );

  if (publishedWorkflow.isLoading) {
    return <LoadingScreen />;
  }

  if (!publishedWorkflow.data) {
    return <Box padding={8}>Workflow not found.</Box>;
  }

  const parsed = parseStudioWorkflow(publishedWorkflow.data.dsl);

  return (
    <Box height="100vh">
      <Box height="full" bg="bg.muted" padding={16} paddingTop={4}>
        <FullLogo />
        <ChakraCard.Root height="90%" bg="bg.panel" padding={5} marginTop={4}>
          <WorkflowChatBox
            workflowId={workflowId}
            nodes={parsed?.nodes as unknown as Node[]}
            edges={parsed?.edges as unknown as Edge[]}
          />
        </ChakraCard.Root>
      </Box>
    </Box>
  );
}

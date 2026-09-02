/**
 * The standalone chat address for a published workflow.
 *
 * A MOVE of `platform/app/src/pages/[project]/chat/[workflow].tsx` together with
 * the `ChatBox` half of
 * `platform/app/src/optimization_studio/components/ChatWindow.tsx`, whose only
 * consumer this address was.
 *
 * THIS PAGE HAS NO CHROME AND NEVER HAD ANY. It paints the product mark and one
 * card on a full-height panel, which is why the loading screen and the logo
 * travelled with it as family-local copies: there is nothing else on the page
 * to look at while the published version loads.
 *
 * THE `ChatWindow` DIALOG DID NOT TRAVEL, and it is a deletion rather than a
 * loss: it wrapped `ChatBox` in a Test Message dialog and NOTHING in the
 * repository rendered it. The studio's own test-message affordance is its own.
 *
 * `dynamic(..., { ssr: false })` did not travel either. It was a Next.js
 * artefact — the compat shim's own comment on the page said so — and the chat
 * box is imported directly here. The `isClient` gate it guarded goes with it:
 * this application does not render on a server.
 */

import { Box, Card as ChakraCard } from "@chakra-ui/react";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";
import type { Edge, Node } from "@xyflow/react";

import { workflowApi } from "../../behavior/workflow-api";
import { useWorkflowHost } from "../../model/workflow-host";
import { FullLogo } from "../../ui/elements/full-logo";
import { LoadingScreen } from "../../ui/sections/loading-screen";
import { WorkflowChatBox } from "../../ui/sections/workflow-chat-box";

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

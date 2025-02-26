import { Box, Card as ChakraCard } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { FullLogo } from "../../../components/icons/FullLogo";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { ChatBox } from "../../../optimization_studio/components/ChatWindow";
import { api } from "../../../utils/api";
import { type Edge, type Node } from "@xyflow/react";
import { type Workflow } from "../../../optimization_studio/types/dsl";
import { LoadingScreen } from "../../../components/LoadingScreen";

export default function ChatPage() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const workflowId = router.query.workflow as string;

  const publishedWorkflow = api.optimization.getPublishedWorkflow.useQuery(
    {
      workflowId: workflowId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

  if (publishedWorkflow.isLoading) {
    return <LoadingScreen />;
  }

  if (!publishedWorkflow.data) {
    return;
  }

  return (
    <Box height="100vh">
      <Box height="full" bg="gray.100" p={16} pt={4}>
        <FullLogo />
        <ChakraCard.Root height="90%" bg="white" p={5} mt={4}>
          <ChatBox
            useApi={true}
            workflowId={workflowId}
            nodes={
              (publishedWorkflow.data.dsl as unknown as Workflow)
                ?.nodes as unknown as Node[]
            }
            edges={
              (publishedWorkflow.data.dsl as unknown as Workflow)
                ?.edges as unknown as Edge[]
            }
          />
        </ChakraCard.Root>
      </Box>
    </Box>
  );
}

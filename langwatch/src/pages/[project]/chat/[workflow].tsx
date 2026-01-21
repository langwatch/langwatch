import { Box, Card as ChakraCard } from "@chakra-ui/react";
import type { Edge, Node } from "@xyflow/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { FullLogo } from "../../../components/icons/FullLogo";
import { LoadingScreen } from "../../../components/LoadingScreen";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { Workflow } from "../../../optimization_studio/types/dsl";
import { api } from "../../../utils/api";

const ChatBox = dynamic(
  () =>
    import("../../../optimization_studio/components/ChatWindow").then(
      (mod) => mod.ChatBox,
    ),
  {
    ssr: false,
    loading: () => <LoadingScreen />,
  },
);

function ChatContent() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const workflowId = router.query.workflow as string;

  const publishedWorkflow = api.optimization.getPublishedWorkflow.useQuery(
    {
      workflowId: workflowId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!workflowId,
    },
  );

  const [isClient, setIsClient] = useState(false);
  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient || !router.isReady || publishedWorkflow.isLoading) {
    return <LoadingScreen />;
  }

  if (!publishedWorkflow.data) {
    return <Box p={8}>Workflow not found.</Box>;
  }

  return (
    <Box height="100vh">
      <Box height="full" bg="bg.muted" p={16} pt={4}>
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

const ClientOnlyChatContent = dynamic(() => Promise.resolve(ChatContent), {
  ssr: false,
});

export default function ChatPage() {
  return <ClientOnlyChatContent />;
}

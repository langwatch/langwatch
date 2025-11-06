import {
  HStack,
  Button,
  type StackProps,
  Alert,
  VStack,
  Text,
} from "@chakra-ui/react";
import { useDrawer } from "../CurrentDrawer";
import { LuListTree, LuTriangleAlert } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

interface TraceMessageProps extends StackProps {
  traceId: string;
}

export function TraceMessage({ traceId, ...props }: TraceMessageProps) {
  const { openDrawer, drawerOpen } = useDrawer();
  const { project } = useOrganizationTeamProject();

  const traceQuery = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId },
    {
      enabled: !!project && !!traceId,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  );

  // Don't render anything while loading
  if (traceQuery.isLoading) {
    return null;
  }

  // Show inline warning if trace not found after retries
  if (traceQuery.isError || !traceQuery.data) {
    return (
      <Alert.Root status="warning" size="sm" marginY={4}>
        <Alert.Content>
          <Alert.Description>
            <VStack align="start" gap={0}>
              <Text fontSize="xs">Trace not found. [trace_id: {traceId}]</Text>
            </VStack>
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return (
    <HStack marginTop={-6} paddingBottom={4} {...props}>
      <Button
        colorPalette="gray"
        onClick={() => {
          if (drawerOpen("traceDetails")) {
            openDrawer(
              "traceDetails",
              {
                traceId: traceId ?? "",
                selectedTab: "traceDetails",
              },
              { replace: true },
            );
          } else {
            openDrawer("traceDetails", {
              traceId: traceId ?? "",
              selectedTab: "traceDetails",
            });
          }
        }}
      >
        <LuListTree />
        View Trace
      </Button>
    </HStack>
  );
}

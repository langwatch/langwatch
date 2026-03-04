import {
  Box,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";
import { Drawer } from "../ui/drawer";
import { CustomCopilotKitChat } from "./CustomCopilotKitChat";
import { CriteriaSummary, DrawerHeader } from "./ScenarioRunDetailContent";

export interface ScenarioRunDetailDrawerProps {
  open?: boolean;
}

export function ScenarioRunDetailDrawer({
  open,
}: ScenarioRunDetailDrawerProps) {
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const { project } = useOrganizationTeamProject();

  const scenarioRunId = params.scenarioRunId;

  const { data: scenarioState } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId: scenarioRunId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId && !!open,
    },
  );

  return (
    <Drawer.Root
      open={!!open}
      onOpenChange={() => {
        closeDrawer();
      }}
      placement="end"
      size="lg"
    >
      <Drawer.Backdrop />
      <Drawer.Content paddingX={0} maxWidth="50%">
        <Drawer.CloseTrigger />
        {!scenarioState && open && (
          <Drawer.Body>
            <VStack gap={4} align="start" w="100%" pt={4}>
              <Skeleton height="32px" width="60%" />
              <Skeleton height="24px" width="40%" />
              <Skeleton height="200px" width="100%" borderRadius="md" />
            </VStack>
          </Drawer.Body>
        )}
        {scenarioState && (
          <>
            <DrawerHeader
              name={scenarioState.name}
              status={scenarioState.status}
              durationInMs={scenarioState.durationInMs}
            />
            <Drawer.Body overflow="auto" px={5} py={4}>
              <VStack gap={6} align="stretch">
                <CriteriaSummary results={scenarioState.results} />
                <ConversationSection
                  messages={scenarioState.messages}
                  projectSlug={project?.slug}
                />
              </VStack>
            </Drawer.Body>
          </>
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}

function ConversationSection({
  messages,
  projectSlug,
}: {
  messages: ScenarioMessageSnapshotEvent["messages"];
  projectSlug?: string;
}) {
  const traceId = messages.find((m) => m.trace_id)?.trace_id;

  return (
    <Box>
      <HStack justify="space-between" mb={2}>
        <Text fontWeight="semibold">Conversation</Text>
        {traceId && projectSlug && (
          <a
            href={`/${projectSlug}/messages/${traceId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <HStack color="blue.500" fontSize="sm" gap={1}>
              <Text>View Trace</Text>
              <ExternalLink size={12} />
            </HStack>
          </a>
        )}
      </HStack>
      <Box
        border="1px"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
      >
        <CustomCopilotKitChat
          messages={messages}
          hideInput
          smallerView
        />
      </Box>
    </Box>
  );
}

/**
 * What the run drawer reads while the run has no state yet: queued, or the
 * read that failed.
 *
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 */

import { Box, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";
import { HandledErrorAlert } from "~/features/errors";
import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { api } from "~/utils/api";

export function RunDrawerQueuedBody({
  error,
  scenarioId,
}: {
  error: unknown;
  scenarioId: string | undefined;
}) {
  const { project } = useOrganizationTeamProject();
  const params = useDrawerParams();
  const targetNameMap = useTargetNameMap();

  const { data: scenario } = api.scenarios.getByIdIncludingArchived.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project?.id && !!scenarioId },
  );

  const targetName = params.targetId
    ? (targetNameMap.get(params.targetId) ?? null)
    : null;

  const isNotFound =
    !!error &&
    (error as { data?: { code?: string } }).data?.code === "NOT_FOUND";
  const hasHardError = error && !isNotFound;

  return (
    <Drawer.Body bg={{ base: "bg.surface", _dark: "bg.panel" }}>
      <VStack gap={3} align="start" w="100%" pt={4}>
        <Drawer.CloseTrigger />
        {hasHardError ? (
          <Box width="100%">
            <HandledErrorAlert
              error={error}
              fallbackTitle="Failed to load run"
            />
          </Box>
        ) : (
          <VStack gap={2} align="start" data-testid="wide-drawer-queued">
            <Heading size="md">{scenario?.name ?? "Run"}</Heading>
            {targetName && (
              <Text color="fg.muted" fontSize="sm">
                against {targetName}
              </Text>
            )}
            <HStack gap={2} color="fg.muted">
              <Spinner size="xs" />
              <Text fontSize="sm">Queued</Text>
            </HStack>
          </VStack>
        )}
      </VStack>
    </Drawer.Body>
  );
}

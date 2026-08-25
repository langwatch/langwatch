/**
 * The version history of a test case: every saved version, newest first, with
 * who saved it, when, and which fields changed. An older version can be opened
 * read-only and restored; a restore writes the old content forward as a new
 * version, so nothing in the list is lost.
 *
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

import { Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import { useCan } from "~/hooks/useCan";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { ScenarioVersionRow } from "./ScenarioVersionRow";
import type { VersionEntry } from "./scenario-versions";
import { useVersionRestore } from "./useVersionRestore";

export function ScenarioVersionHistoryDrawer({ open }: { open?: boolean }) {
  const { closeDrawer, goBack, canGoBack } = useDrawer();
  const params = useDrawerParams();
  const scenarioId = params.scenarioId ?? "";
  const markVersion = params.markVersion ? Number(params.markVersion) : null;

  const close = canGoBack ? goBack : closeDrawer;
  const isOpen = open !== false;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open: stillOpen }) => !stillOpen && close()}
      placement="end"
      size="md"
    >
      <Drawer.Content bg="bg" data-testid="scenario-version-history">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            Version history
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VersionList scenarioId={scenarioId} markVersion={markVersion} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/** The read that failed, with a way to try it again. */
function VersionHistoryError({ onRetry }: { onRetry: () => void }) {
  return (
    <VStack gap={3} paddingY={8} data-testid="version-history-error">
      <Text role="alert" color="fg.error" textAlign="center">
        The history could not be loaded.
      </Text>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </VStack>
  );
}

function VersionList({
  scenarioId,
  markVersion,
}: {
  scenarioId: string;
  markVersion: number | null;
}) {
  const { can } = useCan();
  const { project } = useOrganizationTeamProject();
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const restore = useVersionRestore({ scenarioId });

  const versionsQuery = api.scenarios.listVersions.useQuery(
    { projectId: project?.id ?? "", scenarioId },
    { enabled: !!project?.id && !!scenarioId },
  );

  if (versionsQuery.isLoading) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner />
      </HStack>
    );
  }

  if (versionsQuery.isError) {
    return <VersionHistoryError onRetry={() => void versionsQuery.refetch()} />;
  }

  const versions = (versionsQuery.data?.versions ?? []) as VersionEntry[];
  const currentVersion = versions[0]?.version;

  if (versions.length === 0) {
    return (
      <Text color="fg.muted" textAlign="center" paddingY={8}>
        No versions saved yet.
      </Text>
    );
  }

  const toggleVersion = (version: number) =>
    setOpenVersion((held) => (held === version ? null : version));

  return (
    <>
      <VStack gap={0} align="stretch">
        {versions.map((entry) => (
          <ScenarioVersionRow
            key={entry.version}
            scenarioId={scenarioId}
            entry={entry}
            isCurrent={entry.version === currentVersion}
            isMarked={markVersion === entry.version}
            isOpen={openVersion === entry.version}
            onToggleOpen={() => toggleVersion(entry.version)}
            canRestore={can("scenarios:manage") && !entry.isSynthesized}
            restore={restore}
          />
        ))}
      </VStack>
      <Text color="fg.muted" fontSize="xs" paddingTop={4}>
        A restore writes the old content forward as a new version, so nothing in
        this list is lost.
      </Text>
    </>
  );
}

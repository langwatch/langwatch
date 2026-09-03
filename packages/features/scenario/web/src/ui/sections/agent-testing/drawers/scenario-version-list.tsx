/**
 * The version history of a scenario: every saved version, newest first, with
 * who saved it, when, and which fields changed. An older version can be opened
 * read-only and restored; a restore writes the old content forward as a new
 * version, so nothing in the list is lost.
 *
 * One list, read by the popover the case dialog opens and by the v1 drawer.
 *
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
 */

import { Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { useCan } from "../../../../behavior/use-can";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/scenario-api";
import { ScenarioVersionRow } from "./scenario-version-row";
import type { VersionEntry } from "../../../../model/agent-testing/drawers/scenario-versions";
import { useVersionRestore } from "../../../../behavior/agent-testing/drawers/use-version-restore";

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

export function ScenarioVersionList({
  scenarioId,
  markVersion,
  /** True while the list is inside a popover, which reads at dialog scale. */
  isCompact = false,
}: {
  scenarioId: string;
  markVersion: number | null;
  isCompact?: boolean;
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
      <VStack
        gap={0}
        align="stretch"
        maxHeight={isCompact ? "320px" : undefined}
        overflowY={isCompact ? "auto" : undefined}
      >
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
        A restore writes the old content forward as a new version, so nothing in this list is lost.
      </Text>
    </>
  );
}

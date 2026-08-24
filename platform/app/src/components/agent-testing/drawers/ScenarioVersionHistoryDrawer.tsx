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

import {
  Badge,
  Box,
  Button,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useCan } from "~/hooks/useCan";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

type VersionEntry = {
  version: number;
  authorId: string | null;
  authorLabel: string | null;
  authorName?: string | null;
  changeDescription: string | null;
  changedFields: string[];
  createdAt: Date | string;
  synthesized: boolean;
};

/** Who saved a version, in the words the reader knows the writer by. */
function authorOf(entry: VersionEntry): string | null {
  if (entry.authorLabel === "langy") return "Langy";
  if (entry.authorLabel === "api") return "API";
  if (entry.authorLabel === "cli") return "CLI";
  if (entry.authorLabel === "user") return entry.authorName ?? "You";
  return null;
}

/** What one entry says changed: the field list, or the description it holds. */
function changeLineOf(entry: VersionEntry): string {
  if (entry.changedFields.length > 0) {
    return `changed ${entry.changedFields.join(", ")}`;
  }
  return entry.changeDescription ?? "Created";
}

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

function VersionList({
  scenarioId,
  markVersion,
}: {
  scenarioId: string;
  markVersion: number | null;
}) {
  const { project } = useOrganizationTeamProject();
  const { can } = useCan();
  const utils = api.useUtils();
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [confirmingVersion, setConfirmingVersion] = useState<number | null>(
    null,
  );

  const versionsQuery = api.scenarios.listVersions.useQuery(
    { projectId: project?.id ?? "", scenarioId },
    { enabled: !!project?.id && !!scenarioId },
  );

  const restoreMutation = api.scenarios.restoreVersion.useMutation({
    onSuccess: (_result, variables) => {
      void utils.scenarios.listVersions.invalidate();
      void utils.scenarios.getAll.invalidate();
      void utils.scenarios.getById.invalidate();
      void utils.scenarios.getByIdIncludingArchived.invalidate();
      toaster.create({
        title: `Restored version ${variables.version}`,
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't restore this version" }),
    onSettled: () => setConfirmingVersion(null),
  });

  if (versionsQuery.isLoading) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner />
      </HStack>
    );
  }

  if (versionsQuery.isError) {
    return (
      <VStack gap={3} paddingY={8} data-testid="version-history-error">
        <Text role="alert" color="fg.error" textAlign="center">
          The history could not be loaded.
        </Text>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void versionsQuery.refetch()}
        >
          Try again
        </Button>
      </VStack>
    );
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

  return (
    <>
      <VStack gap={0} align="stretch">
        {versions.map((entry) => (
          <VersionRow
            key={entry.version}
            scenarioId={scenarioId}
            entry={entry}
            isCurrent={entry.version === currentVersion}
            isMarked={markVersion === entry.version}
            isOpen={openVersion === entry.version}
            onToggleOpen={() =>
              setOpenVersion((held) =>
                held === entry.version ? null : entry.version,
              )
            }
            canRestore={can("scenarios:manage") && !entry.synthesized}
            isConfirming={confirmingVersion === entry.version}
            isRestoring={
              restoreMutation.isPending &&
              restoreMutation.variables?.version === entry.version
            }
            onAskRestore={() => setConfirmingVersion(entry.version)}
            onCancelRestore={() => setConfirmingVersion(null)}
            onConfirmRestore={() =>
              restoreMutation.mutate({
                projectId: project?.id ?? "",
                scenarioId,
                version: entry.version,
              })
            }
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

function VersionRow({
  scenarioId,
  entry,
  isCurrent,
  isMarked,
  isOpen,
  onToggleOpen,
  canRestore,
  isConfirming,
  isRestoring,
  onAskRestore,
  onCancelRestore,
  onConfirmRestore,
}: {
  scenarioId: string;
  entry: VersionEntry;
  isCurrent: boolean;
  isMarked: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  canRestore: boolean;
  isConfirming: boolean;
  isRestoring: boolean;
  onAskRestore: () => void;
  onCancelRestore: () => void;
  onConfirmRestore: () => void;
}) {
  const author = authorOf(entry);

  return (
    <VStack
      align="stretch"
      gap={0}
      borderBottom="1px solid"
      borderColor="border.muted"
      data-testid={`version-row-${entry.version}`}
    >
      <HStack align="start" justify="space-between" gap={3} paddingY={3}>
        <VStack
          as="button"
          align="start"
          gap={0}
          flex={1}
          minWidth={0}
          cursor="pointer"
          textAlign="left"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
        >
          <HStack gap={2}>
            <Text fontWeight="medium" fontSize="sm">
              v{entry.version}
            </Text>
            {author && (
              <Text color="fg.muted" fontSize="sm">
                · {author}
              </Text>
            )}
            {isCurrent && (
              <Badge size="sm" colorPalette="green">
                Current
              </Badge>
            )}
            {isMarked && !isCurrent && (
              <Badge size="sm" colorPalette="blue">
                This run
              </Badge>
            )}
          </HStack>
          <Text color="fg.muted" fontSize="xs" lineClamp={2}>
            {changeLineOf(entry)} ·{" "}
            {formatTimeAgo(new Date(entry.createdAt).getTime())}
          </Text>
        </VStack>

        {canRestore && !isCurrent && (
          <HStack gap={1} flexShrink={0}>
            {isConfirming ? (
              <>
                <Button
                  size="xs"
                  colorPalette="orange"
                  loading={isRestoring}
                  onClick={onConfirmRestore}
                  data-testid={`confirm-restore-${entry.version}`}
                >
                  Restore v{entry.version}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={isRestoring}
                  onClick={onCancelRestore}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={onAskRestore}
                data-testid={`restore-${entry.version}`}
              >
                Restore
              </Button>
            )}
          </HStack>
        )}
      </HStack>

      {isOpen && !entry.synthesized && (
        <VersionContent scenarioId={scenarioId} version={entry.version} />
      )}
    </VStack>
  );
}

/** What one version held, read-only. */
function VersionContent({
  scenarioId,
  version,
}: {
  scenarioId: string;
  version: number;
}) {
  const { project } = useOrganizationTeamProject();
  const { data, isLoading } = api.scenarios.getVersion.useQuery(
    { projectId: project?.id ?? "", scenarioId, version },
    { enabled: !!project?.id && !!scenarioId },
  );

  if (isLoading) {
    return (
      <HStack justify="center" paddingY={3}>
        <Spinner size="xs" />
      </HStack>
    );
  }
  if (!data) return null;

  const fields = data.fields;

  return (
    <VStack
      align="stretch"
      gap={2}
      paddingBottom={3}
      data-testid={`version-content-${version}`}
    >
      <VersionField label="Name" value={fields.name} />
      <VersionField label="Situation" value={fields.situation} />
      {(fields.criteria ?? []).length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight="medium" color="fg.muted">
            Criteria
          </Text>
          <VStack align="stretch" gap={0.5} paddingTop={1}>
            {(fields.criteria ?? []).map((criterion, index) => (
              <Text key={index} fontSize="xs">
                · {criterion}
              </Text>
            ))}
          </VStack>
        </Box>
      )}
      {(fields.labels ?? []).length > 0 && (
        <VersionField label="Labels" value={(fields.labels ?? []).join(", ")} />
      )}
    </VStack>
  );
}

function VersionField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <Box>
      <Text fontSize="xs" fontWeight="medium" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="xs" whiteSpace="pre-wrap">
        {value}
      </Text>
    </Box>
  );
}

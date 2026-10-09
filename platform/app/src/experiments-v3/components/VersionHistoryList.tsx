/**
 * The workbench's saved versions, as a list.
 *
 * It is rendered inside the popover the history button anchors
 * (`VersionHistoryButton`). The list owns the query, the current badge and the
 * two-step restore; the popover only gives it a place to sit.
 */
import { Badge, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useCan } from "~/hooks/useCan";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

interface VersionEntry {
  version: number;
  counterVersion: number;
  autoSaved: boolean;
  commitMessage: string | null;
  authorLabel: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date | string;
  /**
   * When the row was last written. The autosave row is rewritten in place, so
   * its `createdAt` is the start of the session and only this says how old
   * what it holds is.
   */
  updatedAt: Date | string;
}

/**
 * Who saved a version, in the words the reader knows the writer by.
 *
 * A version written by a person is theirs, so it carries their name when we
 * have one and "You" when we do not. The person reading their own history is
 * by far the common case, and a bare id helps no one. The two automated
 * writers name themselves.
 */
const authorOf = (entry: VersionEntry): string => {
  if (entry.authorLabel === "langy") return "Langy";
  if (entry.authorLabel === "api") return "API";
  return entry.authorName ?? "You";
};

/**
 * What the row is called.
 *
 * Numbered versions are the ones a person made on purpose, and they run 1, 2,
 * 3 with no gaps. Typing writes one autosave row that every later save
 * rewrites, so its number changes under the reader and means nothing to them.
 * It is named for what it is instead.
 */
const titleOf = (entry: VersionEntry): string =>
  entry.autoSaved ? "Autosave" : `v${entry.version}`;

/**
 * Restore a saved version and leave the open workbench holding it.
 *
 * The restore is finished only once the page's own query has answered again
 * and the store holds what it returned, so this refetches the same query the
 * page loads by rather than keeping a second copy of the mapping.
 */
const useVersionRestore = ({
  experimentId,
  experimentSlug,
  onRestored,
  onSettled,
}: {
  experimentId: string;
  experimentSlug: string;
  onRestored: () => void;
  onSettled: () => void;
}) => {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const loadState = useEvaluationsV3Store((state) => state.loadState);
  const setWorkbenchVersion = useEvaluationsV3Store(
    (state) => state.setWorkbenchVersion,
  );
  const setStaleWorkbench = useEvaluationsV3Store(
    (state) => state.setStaleWorkbench,
  );
  const restoreVersion = api.experiments.restoreWorkbenchVersion.useMutation();
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  const restore = async (entry: VersionEntry) => {
    if (!project) return;
    const version = entry.version;
    setRestoringVersion(version);
    try {
      await restoreVersion.mutateAsync({
        projectId: project.id,
        experimentId,
        version,
      });

      await utils.experiments.getEvaluationsV3BySlug.invalidate({
        projectId: project.id,
        experimentSlug,
      });
      const fresh = await utils.experiments.getEvaluationsV3BySlug.fetch({
        projectId: project.id,
        experimentSlug,
      });
      if (fresh.workbenchState) {
        loadState(fresh.workbenchState);
      }
      // The restore is a new version; echoing it keeps the next autosave's
      // compare-and-set honest, and the workbench is current again.
      setWorkbenchVersion(fresh.version);
      setStaleWorkbench(undefined);
      await utils.experiments.listWorkbenchVersions.invalidate({
        projectId: project.id,
        experimentId,
      });

      toaster.create({
        title: entry.autoSaved
          ? "Restored the autosave"
          : `Restored version ${version}`,
        type: "success",
      });
      onRestored();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't restore this version" });
    } finally {
      setRestoringVersion(null);
      onSettled();
    }
  };

  return { restore, restoringVersion };
};

function VersionRow({
  entry,
  isCurrent,
  isConfirming,
  isRestoring,
  canRestore,
  onAskRestore,
  onConfirmRestore,
  onCancelRestore,
}: {
  entry: VersionEntry;
  isCurrent: boolean;
  isConfirming: boolean;
  isRestoring: boolean;
  canRestore: boolean;
  onAskRestore: () => void;
  onConfirmRestore: () => void;
  onCancelRestore: () => void;
}) {
  return (
    <HStack
      align="start"
      justify="space-between"
      gap={3}
      paddingY={3}
      borderBottom="1px solid"
      borderColor="border.muted"
    >
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2}>
          <Text fontWeight="medium" fontSize="sm">
            {titleOf(entry)}
          </Text>
          <Text color="fg.muted" fontSize="sm">
            · {authorOf(entry)}
          </Text>
          {isCurrent && (
            <Badge size="sm" colorPalette="green">
              Current
            </Badge>
          )}
        </HStack>
        <Text color="fg.muted" fontSize="xs" lineClamp={2}>
          {entry.commitMessage ? `${entry.commitMessage} · ` : ""}
          {formatTimeAgo(new Date(entry.updatedAt).getTime())}
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
              >
                Confirm restore
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
            <Button size="xs" variant="outline" onClick={onAskRestore}>
              Restore
            </Button>
          )}
        </HStack>
      )}
    </HStack>
  );
}

export function VersionList({
  experimentId,
  experimentSlug,
  onRestored,
}: {
  experimentId: string;
  experimentSlug: string;
  onRestored: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const { can } = useCan();
  const [confirmingVersion, setConfirmingVersion] = useState<number | null>(
    null,
  );
  const workbenchVersion = useEvaluationsV3Store(
    (state) => state.workbenchVersion,
  );
  const { restore, restoringVersion } = useVersionRestore({
    experimentId,
    experimentSlug,
    onRestored,
    onSettled: () => setConfirmingVersion(null),
  });

  const versionsQuery = api.experiments.listWorkbenchVersions.useQuery(
    { projectId: project?.id ?? "", experimentId },
    { enabled: !!project?.id && !!experimentId },
  );

  const versions = (versionsQuery.data?.versions ?? []) as VersionEntry[];
  // The row holding what the workbench shows now is the one written at the
  // page's own version. The list is ordered by that number, so the newest row
  // is the answer whenever the page is behind the server and no row matches.
  const currentCounterVersion =
    workbenchVersion !== undefined &&
    versions.some((entry) => entry.counterVersion === workbenchVersion)
      ? workbenchVersion
      : versions[0]?.counterVersion;

  if (versionsQuery.isLoading) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner />
      </HStack>
    );
  }
  if (versionsQuery.isError) {
    return (
      <Text role="alert" color="red.fg" textAlign="center" paddingY={8}>
        Failed to load the version history.
      </Text>
    );
  }
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
            entry={entry}
            isCurrent={entry.counterVersion === currentCounterVersion}
            isConfirming={confirmingVersion === entry.version}
            isRestoring={restoringVersion === entry.version}
            canRestore={can("experiments:update")}
            onAskRestore={() => setConfirmingVersion(entry.version)}
            onConfirmRestore={() => void restore(entry)}
            onCancelRestore={() => setConfirmingVersion(null)}
          />
        ))}
      </VStack>
      <Text color="fg.muted" fontSize="xs" paddingTop={4}>
        A restore writes the old setup forward as a new version, so nothing in
        this list is lost.
      </Text>
    </>
  );
}

import { Badge, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useCan } from "~/hooks/useCan";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

interface VersionEntry {
  version: number;
  autoSaved: boolean;
  commitMessage: string | null;
  authorLabel: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date | string;
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

export function VersionHistoryDrawer({
  experimentId,
  experimentSlug,
}: {
  experimentId: string;
  experimentSlug: string;
}) {
  const { closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const { can } = useCan();
  const utils = api.useUtils();
  const loadState = useEvaluationsV3Store((state) => state.loadState);
  const setWorkbenchVersion = useEvaluationsV3Store(
    (state) => state.setWorkbenchVersion,
  );
  const setStaleWorkbench = useEvaluationsV3Store(
    (state) => state.setStaleWorkbench,
  );
  const [confirmingVersion, setConfirmingVersion] = useState<number | null>(
    null,
  );
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  const canRestore = can("experiments:update");

  const versionsQuery = api.experiments.listWorkbenchVersions.useQuery(
    { projectId: project?.id ?? "", experimentId },
    { enabled: !!project?.id && !!experimentId },
  );

  const restoreVersion = api.experiments.restoreWorkbenchVersion.useMutation();

  const versions = (versionsQuery.data?.versions ?? []) as VersionEntry[];
  const currentVersion = versions[0]?.version;

  const handleRestore = async (version: number) => {
    if (!project) return;
    setRestoringVersion(version);
    try {
      await restoreVersion.mutateAsync({
        projectId: project.id,
        experimentId,
        version,
      });

      // The workbench reads its state through `getEvaluationsV3BySlug`, so the
      // restore is finished only once that query has answered again and the
      // store holds what it returned. Invalidate, refetch, load: the same path
      // the page itself loads by, rather than a second copy of the mapping.
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
        title: `Restored version ${version}`,
        type: "success",
      });
      closeDrawer();
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't restore this version",
      });
    } finally {
      setRestoringVersion(null);
      setConfirmingVersion(null);
    }
  };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="md"
      onOpenChange={closeDrawer}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            Version history
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {versionsQuery.isLoading && (
            <HStack justify="center" paddingY={8}>
              <Spinner />
            </HStack>
          )}
          {versionsQuery.isError && (
            <Text role="alert" color="red.fg" textAlign="center" paddingY={8}>
              Failed to load the version history.
            </Text>
          )}
          {!versionsQuery.isLoading &&
            !versionsQuery.isError &&
            versions.length === 0 && (
              <Text color="fg.muted" textAlign="center" paddingY={8}>
                No versions saved yet.
              </Text>
            )}
          {versions.length > 0 && (
            <VStack gap={0} align="stretch">
              {versions.map((entry) => {
                const isCurrent = entry.version === currentVersion;
                const isConfirming = confirmingVersion === entry.version;
                const isRestoring = restoringVersion === entry.version;

                return (
                  <HStack
                    key={entry.version}
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
                          v{entry.version}
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
                              onClick={() => void handleRestore(entry.version)}
                            >
                              Confirm restore
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={isRestoring}
                              onClick={() => setConfirmingVersion(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setConfirmingVersion(entry.version)}
                          >
                            Restore
                          </Button>
                        )}
                      </HStack>
                    )}
                  </HStack>
                );
              })}
            </VStack>
          )}

          {versions.length > 0 && (
            <Text color="fg.muted" fontSize="xs" paddingTop={4}>
              A restore writes the old setup forward as a new version, so
              nothing in this list is lost.
            </Text>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

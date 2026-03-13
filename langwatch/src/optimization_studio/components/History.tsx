import {
  Avatar,
  Box,
  type BoxProps,
  Button,
  HStack,
  Separator,
  Tag,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { useCallback, useEffect, useMemo } from "react";
import { type UseFormReturn, FormProvider, useForm } from "react-hook-form";

import { HistoryIcon } from "../../components/icons/History";
import { Popover } from "../../components/ui/popover";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useWorkflowStore, serializeWorkflow } from "../hooks/useWorkflowStore";
import type { Workflow } from "../types/dsl";
import { hasDSLChanged } from "../utils/dslUtils";
import { NewVersionFields } from "./VersionToBeUsed";

export function History() {
  const { open, onToggle, onClose, setOpen } = useDisclosure();

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open }) => setOpen(open)}
      // closeOnInteractOutside={false}
      // modal
    >
      <Popover.Trigger asChild>
        <Button variant="ghost" color="fg.subtle" size="xs" onClick={onToggle}>
          <HistoryIcon size={16} />
        </Button>
      </Popover.Trigger>
      {open && <HistoryPopover onClose={onClose} />}
    </Popover.Root>
  );
}

export function HistoryPopover({ onClose }: { onClose: () => void }) {
  const { project } = useOrganizationTeamProject();
  const {
    workflowId,
    getWorkflow,
    setWorkflow,
    setAutosavedWorkflow,
    setLastCommittedWorkflow,
    setCurrentVersionId,
  } = useWorkflowStore(
    ({
      workflow_id: workflowId,
      getWorkflow,
      setWorkflow,
      setAutosavedWorkflow,
      setLastCommittedWorkflow,
      setCurrentVersionId,
    }) => ({
      workflowId,
      getWorkflow,
      setWorkflow,
      setAutosavedWorkflow,
      setLastCommittedWorkflow,
      setCurrentVersionId,
    }),
  );
  const form = useForm<{ version: string; commitMessage: string }>({
    defaultValues: {
      version: "",
      commitMessage: "",
    },
  });

  const {
    versions,
    currentVersion,
    hasChanges,
    canSaveNewVersion,
    nextVersion,
  } = useVersionState({ project, form });

  const commitVersion = api.workflow.commitVersion.useMutation();
  const restoreVersion = api.workflow.restoreVersion.useMutation();

  const onSubmit = ({
    version,
    commitMessage,
  }: {
    version: string;
    commitMessage: string;
  }) => {
    if (!project || !workflowId) return;

    commitVersion.mutate(
      {
        projectId: project.id,
        workflowId,
        commitMessage,
        dsl: serializeWorkflow({
          ...getWorkflow(),
          version,
        }),
      },
      {
        onSuccess: () => {
          toaster.create({
            title: `Saved version ${version}`,
            type: "success",
            duration: 5000,
            meta: { closable: true },
          });
          setWorkflow({
            version,
          });
          setLastCommittedWorkflow(getWorkflow());
          void versions.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Error saving version",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const onRestoreSuccess = useCallback(
    async (versionId: string) => {
      if (!project || !workflowId) return;

      if (currentVersion?.autoSaved) {
        if (!confirm("Autosaved changes might be lost. Continue?")) {
          return;
        }
      } else if (hasChanges) {
        if (!confirm("Unsaved changes will be lost. Continue?")) {
          return;
        }
      }

      const version = await restoreVersion.mutateAsync({
        projectId: project.id,
        versionId,
      });

      // Prevent autosave from triggering after restore
      setAutosavedWorkflow(undefined);
      const dsl = version.dsl as unknown as Workflow;
      setLastCommittedWorkflow(dsl);
      setCurrentVersionId(version.id);
      setWorkflow({
        ...dsl,
        nodes: (dsl.nodes ?? []).map((node) => ({
          ...node,
          selected: false,
        })),
      });
      onClose();
    },
    [
      project,
      workflowId,
      currentVersion?.autoSaved,
      hasChanges,
      restoreVersion,
      setWorkflow,
      setAutosavedWorkflow,
      setLastCommittedWorkflow,
      setCurrentVersionId,
      onClose,
    ],
  );

  return (
    <Popover.Content width="500px">
      <Popover.Arrow />
      <Popover.Header fontWeight={600}>Workflow Versions</Popover.Header>
      <Popover.CloseTrigger />
      <Popover.Body padding={0}>
        <FormProvider {...form}>
          <form
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            onSubmit={form.handleSubmit(onSubmit)}
            style={{ width: "100%", padding: "20px" }}
          >
            <VStack align="start" width="full">
              <NewVersionFields />
              <Tooltip
                content={!canSaveNewVersion ? "No changes to save" : ""}
                positioning={{ placement: "top" }}
              >
                <Button
                  type="submit"
                  alignSelf="end"
                  colorPalette="orange"
                  size="sm"
                  loading={commitVersion.isLoading}
                  disabled={!canSaveNewVersion}
                >
                  Save new version
                </Button>
              </Tooltip>
            </VStack>
          </form>
        </FormProvider>
        <Separator />
        <VStack
          align="start"
          width="full"
          padding={5}
          maxHeight="350px"
          overflowY="auto"
        >
          <Text fontWeight={600} fontSize="16px" paddingTop={2}>
            Previous Versions
          </Text>
          {versions.data?.map((version) => (
            <VStack
              key={version.id}
              width="full"
              align="start"
              paddingBottom={2}
            >
              <Separator marginBottom={2} />
              <HStack width="full" gap={3}>
                <VersionBox version={version} minWidth="48px" />
                <VStack align="start" width="full" gap={1}>
                  <HStack>
                    <Text fontWeight={600} fontSize="13px" lineClamp={1}>
                      {version.commitMessage}
                    </Text>
                    {version.isCurrentVersion && (
                      <Tag.Root colorPalette="green" size="sm" paddingX={2}>
                        <Tag.Label>current</Tag.Label>
                      </Tag.Root>
                    )}
                  </HStack>
                  <HStack fontSize="12px">
                    <Avatar.Root
                      size="2xs"
                      backgroundColor="orange.400"
                      color="white"
                      width="16px"
                      height="16px"
                    >
                      <Avatar.Fallback
                        name={version.author?.name ?? ""}
                        fontSize="6.4px"
                      />
                    </Avatar.Root>
                    {version.author?.name}
                    {/* {" · "}
                    <Tooltip
                      // content={new Date(version.updatedAt).toLocaleString()}
                      content="what"
                      positioning={{ placement: "top" }}
                    >
                      {formatTimeAgo(version.updatedAt.getTime())}
                    </Tooltip> */}
                  </HStack>
                </VStack>
                {!version.isCurrentVersion && (
                  <Tooltip
                    content="Restore this version"
                    positioning={{ placement: "top" }}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => void onRestoreSuccess(version.id)}
                      loading={restoreVersion.isLoading}
                    >
                      <HistoryIcon size={24} />
                    </Button>
                  </Tooltip>
                )}
              </HStack>
            </VStack>
          ))}
        </VStack>
      </Popover.Body>
    </Popover.Content>
  );
}

export const VersionBox = ({
  version,
  children,
  ...props
}: {
  version?: { autoSaved?: boolean; version: string };
} & BoxProps) => {
  return (
    <Box
      backgroundColor={version?.autoSaved ? "orange.50" : "orange.100"}
      paddingY={3}
      paddingX={2}
      borderRadius={4}
      fontWeight={600}
      fontSize="13px"
      color="fg.muted"
      whiteSpace="nowrap"
      textAlign="center"
      minWidth="0px"
      height="44px"
      {...props}
    >
      {version?.autoSaved ? " " : version?.version}
      {children}
    </Box>
  );
};

export const useVersionState = ({
  project,
  form,
  allowSaveIfAutoSaveIsCurrentButNotLatest = true,
}: {
  project?: Project;
  form?: UseFormReturn<{ version: string; commitMessage: string }>;
  allowSaveIfAutoSaveIsCurrentButNotLatest?: boolean;
}) => {
  const { workflowId, getWorkflow, autosavedWorkflow } = useWorkflowStore(
    ({ workflow_id: workflowId, version, getWorkflow, autosavedWorkflow }) => ({
      workflowId,
      version,
      getWorkflow,
      autosavedWorkflow,
    }),
  );

  const versions = api.workflow.getVersions.useQuery(
    {
      projectId: project?.id ?? "",
      workflowId: workflowId ?? "",
      returnDSL: "previousVersion",
    },
    { enabled: !!project?.id && !!workflowId },
  );
  const currentVersion = versions.data?.find(
    (version) => version.isCurrentVersion,
  );
  const previousVersion = versions.data?.find(
    (version) => version.isPreviousVersion,
  );
  const latestVersion = versions.data?.find(
    (version) => version.isLatestVersion,
  );
  const hasChanges = autosavedWorkflow
    ? hasDSLChanged(getWorkflow(), autosavedWorkflow, false)
    : false;

  const canSaveNewVersion =
    hasChanges ||
    !!latestVersion?.autoSaved ||
    (allowSaveIfAutoSaveIsCurrentButNotLatest && !!currentVersion?.autoSaved);

  const [versionMajor] = latestVersion?.version.split(".") ?? ["0"];
  const nextVersion = useMemo(() => {
    return latestVersion?.autoSaved
      ? latestVersion.version
      : `${parseInt(versionMajor ?? "0") + 1}`;
  }, [latestVersion?.autoSaved, latestVersion?.version, versionMajor]);

  const versionToBeEvaluated = useMemo(() => {
    return canSaveNewVersion
      ? { id: "", version: nextVersion, commitMessage: "" }
      : currentVersion?.autoSaved
        ? {
            id: currentVersion?.parent?.id,
            version: currentVersion?.parent?.version,
            commitMessage: currentVersion?.parent?.commitMessage,
          }
        : {
            id: currentVersion?.id,
            version: currentVersion?.version,
            commitMessage: currentVersion?.commitMessage,
          };
  }, [
    canSaveNewVersion,
    currentVersion?.autoSaved,
    currentVersion?.commitMessage,
    currentVersion?.id,
    currentVersion?.parent?.commitMessage,
    currentVersion?.parent?.id,
    currentVersion?.parent?.version,
    currentVersion?.version,
    nextVersion,
  ]);

  useEffect(() => {
    if (form) {
      form.setValue("version", nextVersion);
    }
  }, [nextVersion, form]);

  return {
    versions,
    currentVersion,
    previousVersion,
    latestVersion,
    hasChanges,
    canSaveNewVersion,
    nextVersion,
    versionToBeEvaluated,
  };
};


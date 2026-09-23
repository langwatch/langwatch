import {
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
import { toaster } from "@langwatch/browser-host/toaster";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { Popover } from "@langwatch/design-system/popover";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { HistoryIcon } from "@langwatch/model-provider-browser-kit";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";
import { useCallback } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { useOrganizationTeamProject } from "../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import { serializeWorkflow } from "../../../behavior/workflow-store.ts";
import { UserAvatar } from "../../elements/user-avatar.tsx";
import { useVersionState } from "./use-version-state.ts";
import { NewVersionFields } from "./version-to-be-used.tsx";

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

  const { versions, currentVersion, hasChanges, canSaveNewVersion } = useVersionState({
    project,
    form,
  });

  const commitVersion = api.workflow.commitVersion.useMutation();
  const restoreVersion = api.workflow.restoreVersion.useMutation();

  const onSubmit = ({ version, commitMessage }: { version: string; commitMessage: string }) => {
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
          });
          setWorkflow({
            version,
          });
          setLastCommittedWorkflow(getWorkflow());
          void versions.refetch();
        },
        onError: (error) => {
          toaster.create({
            error,
            title: "Couldn't save the version",
            type: "error",
            duration: 5000,
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
      } else if (hasChanges && !confirm("Unsaved changes will be lost. Continue?")) {
        return;
      }

      const version = await restoreVersion.mutateAsync({
        projectId: project.id,
        versionId,
      });

      // Prevent autosave from triggering after restore
      setAutosavedWorkflow(undefined);
      const dsl = parseStudioWorkflow(version.dsl);
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
          <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%", padding: "20px" }}>
            <VStack align="start" width="full">
              <NewVersionFields canSaveOverride={canSaveNewVersion} />
              <Tooltip
                content={!canSaveNewVersion ? "No changes to save" : ""}
                positioning={{ placement: "top" }}
              >
                <Button
                  type="submit"
                  alignSelf="end"
                  colorPalette="orange"
                  size="sm"
                  loading={commitVersion.isPending}
                  disabled={!canSaveNewVersion}
                >
                  Save new version
                </Button>
              </Tooltip>
            </VStack>
          </form>
        </FormProvider>
        <Separator />
        <VStack align="start" width="full" padding={5} maxHeight="350px" overflowY="auto">
          <Text fontWeight={600} fontSize="16px" paddingTop={2}>
            Previous Versions
          </Text>
          {versions.data?.map((version) => (
            <VStack key={version.id} width="full" align="start" paddingBottom={2}>
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
                    <UserAvatar
                      size="2xs"
                      backgroundColor="orange.400"
                      color="white"
                      width="16px"
                      height="16px"
                      name={version.author?.name ?? ""}
                      image={version.author?.image}
                    />
                    {version.author?.name}
                  </HStack>
                </VStack>
                {!version.isCurrentVersion && (
                  <Tooltip content="Restore this version" positioning={{ placement: "top" }}>
                    <Button
                      variant="ghost"
                      onClick={() => void onRestoreSuccess(version.id)}
                      loading={restoreVersion.isPending}
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

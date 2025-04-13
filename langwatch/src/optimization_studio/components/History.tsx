import {
  Avatar,
  Box,
  Button,
  Field,
  HStack,
  Input,
  Separator,
  Spinner,
  Tag,
  Text,
  useDisclosure,
  VStack,
  type BoxProps,
} from "@chakra-ui/react";

import type { Project } from "@prisma/client";
import { useCallback, useEffect, useMemo } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useDebounceCallback } from "usehooks-ts";
import { HistoryIcon } from "../../components/icons/History";
import { SmallLabel } from "../../components/SmallLabel";
import { InputGroup } from "../../components/ui/input-group";
import { Popover } from "../../components/ui/popover";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Workflow } from "../types/dsl";
import { hasDSLChanged } from "../utils/dslUtils";
import { AISparklesLoader } from "../../components/icons/AISparklesLoader";

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
        <Button variant="ghost" color="gray.500" size="xs" onClick={onToggle}>
          <HistoryIcon size={16} />
        </Button>
      </Popover.Trigger>
      {open && <HistoryPopover onClose={onClose} />}
    </Popover.Root>
  );
}

export function HistoryPopover({ onClose }: { onClose: () => void }) {
  const { project } = useOrganizationTeamProject();
  const { workflowId, getWorkflow, setWorkflow, setPreviousWorkflow } =
    useWorkflowStore(
      ({
        workflow_id: workflowId,
        getWorkflow,
        setWorkflow,
        setPreviousWorkflow,
      }) => ({
        workflowId,
        getWorkflow,
        setWorkflow,
        setPreviousWorkflow,
      })
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
        dsl: {
          ...getWorkflow(),
          version,
        },
      },
      {
        onSuccess: () => {
          toaster.create({
            title: `Saved version ${version}`,
            type: "success",
            duration: 5000,
            meta: { closable: true },
            placement: "top-end",
          });
          setWorkflow({
            version,
          });
          void versions.refetch();
        },
        onError: () => {
          toaster.create({
            title: "Error saving version",
            type: "error",
            duration: 5000,
            meta: { closable: true },
            placement: "top-end",
          });
        },
      }
    );
  };

  const onRestore = useCallback(
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
      setPreviousWorkflow(undefined);
      setWorkflow(version.dsl as unknown as Workflow);
      onClose();
    },
    [
      project,
      workflowId,
      currentVersion?.autoSaved,
      hasChanges,
      restoreVersion,
      setWorkflow,
      setPreviousWorkflow,
      onClose,
    ]
  );

  return (
    <Popover.Content width="500px">
      <Popover.Arrow />
      <Popover.Header fontWeight={600}>Workflow Versions</Popover.Header>
      <Popover.CloseTrigger />
      <Popover.Body padding={0}>
        <form
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onSubmit={form.handleSubmit(onSubmit)}
          style={{ width: "100%", padding: "20px" }}
        >
          <VStack align="start" width="full">
            <NewVersionFields
              form={form}
              nextVersion={nextVersion}
              canSaveNewVersion={canSaveNewVersion}
            />
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
                      onClick={() => void onRestore(version.id)}
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
      color="gray.600"
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
  const { workflowId, getWorkflow, previousWorkflow } = useWorkflowStore(
    ({ workflow_id: workflowId, version, getWorkflow, previousWorkflow }) => ({
      workflowId,
      version,
      getWorkflow,
      previousWorkflow,
    })
  );

  const versions = api.workflow.getVersions.useQuery(
    {
      projectId: project?.id ?? "",
      workflowId: workflowId ?? "",
      returnDSL: "previousVersion",
    },
    { enabled: !!project?.id && !!workflowId }
  );
  const currentVersion = versions.data?.find(
    (version) => version.isCurrentVersion
  );
  const previousVersion = versions.data?.find(
    (version) => version.isPreviousVersion
  );
  const latestVersion = versions.data?.find(
    (version) => version.isLatestVersion
  );
  const hasChanges = previousWorkflow
    ? hasDSLChanged(getWorkflow(), previousWorkflow, true)
    : false;

  const canSaveNewVersion =
    hasChanges ||
    !!latestVersion?.autoSaved ||
    (allowSaveIfAutoSaveIsCurrentButNotLatest && !!currentVersion?.autoSaved);

  const [versionMajor, versionMinor] = latestVersion?.version.split(".") ?? [
    "0",
    "0",
  ];
  const nextVersion = useMemo(() => {
    return latestVersion?.autoSaved
      ? latestVersion.version
      : `${versionMajor}.${parseInt(versionMinor ?? "0") + 1}`;
  }, [
    latestVersion?.autoSaved,
    latestVersion?.version,
    versionMajor,
    versionMinor,
  ]);

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

export function NewVersionFields({
  form,
  nextVersion,
  canSaveNewVersion,
}: {
  form: UseFormReturn<{ version: string; commitMessage: string }>;
  nextVersion: string;
  canSaveNewVersion: boolean;
}) {
  const { project } = useOrganizationTeamProject();
  const { previousVersion } = useVersionState({
    project,
    form,
  });
  const { getWorkflow } = useWorkflowStore(({ getWorkflow }) => ({
    getWorkflow,
  }));

  const generateCommitMessage =
    api.workflow.generateCommitMessage.useMutation();

  const generateCommitMessageCallback = useCallback(
    (prevDsl: Workflow, newDsl: Workflow) => {
      generateCommitMessage.mutate(
        {
          projectId: project?.id ?? "",
          prevDsl,
          newDsl,
        },
        {
          onSuccess: (data) => {
            if (data) {
              form.setValue("commitMessage", data);
            }
          },
          onError: (e) => {
            toaster.create({
              title: "Error auto-generating version description",
              description: e.message,
              type: "error",
              duration: 5000,
              meta: { closable: true },
              placement: "top-end",
            });
          },
        }
      );
    },
    [form, generateCommitMessage, project?.id]
  );

  const debouncedGenerateCommitMessage = useDebounceCallback(
    (prevDsl: Workflow, newDsl: Workflow) => {
      generateCommitMessageCallback(prevDsl, newDsl);
    },
    500,
    { leading: true, trailing: false }
  );

  useEffect(() => {
    if (canSaveNewVersion && previousVersion?.dsl) {
      form.setValue("commitMessage", "");
      setTimeout(() => {
        debouncedGenerateCommitMessage(previousVersion.dsl!, getWorkflow());

        // Seems like the mutation onSuccess does not work unless we send this call to the end of the callstack for some reason
      }, 0);
    } else if (canSaveNewVersion && !previousVersion) {
      form.setValue("commitMessage", "First version");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSaveNewVersion]);

  return (
    <HStack width="full">
      <Field.Root width="fit-content" invalid={!!form.formState.errors.version}>
        <VStack align="start">
          <Field.Label as={SmallLabel} color="gray.600">
            Version
          </Field.Label>
          <Input
            {...form.register("version", {
              required: true,
              pattern: /^\d+\.\d+$/,
            })}
            placeholder={nextVersion}
            maxWidth="90px"
            pattern="\d+\.\d+"
            disabled={!canSaveNewVersion}
          />
        </VStack>
      </Field.Root>
      <Field.Root width="full" invalid={!!form.formState.errors.commitMessage}>
        <VStack align="start" width="full">
          <Field.Label as={SmallLabel} color="gray.600">
            Description
          </Field.Label>
          <InputGroup
            width="full"
            endElement={
              generateCommitMessage.isLoading ? <AISparklesLoader /> : undefined
            }
          >
            <Input
              {...form.register("commitMessage", {
                required: true,
              })}
              placeholder={
                generateCommitMessage.isLoading
                  ? "Generating..."
                  : "What changes have you made?"
              }
              width="full"
              disabled={!canSaveNewVersion}
            />
          </InputGroup>
        </VStack>
      </Field.Root>
    </HStack>
  );
}

export const VersionToBeUsed = ({
  form,
  nextVersion,
  canSaveNewVersion,
  versionToBeEvaluated,
}: {
  form: UseFormReturn<{ version: string; commitMessage: string }>;
  nextVersion: string;
  canSaveNewVersion: boolean;
  versionToBeEvaluated: {
    id: string | undefined;
    version: string | undefined;
    commitMessage: string | undefined;
  };
}) => {
  if (canSaveNewVersion) {
    return (
      <NewVersionFields
        form={form}
        nextVersion={nextVersion}
        canSaveNewVersion={canSaveNewVersion}
      />
    );
  }

  return (
    <HStack width="full">
      <VStack align="start">
        <SmallLabel color="gray.600">Version</SmallLabel>
        <Text width="74px">{versionToBeEvaluated.version}</Text>
      </VStack>
      <VStack align="start" width="full">
        <SmallLabel color="gray.600">Description</SmallLabel>
        <Text>{versionToBeEvaluated.commitMessage}</Text>
      </VStack>
    </HStack>
  );
};

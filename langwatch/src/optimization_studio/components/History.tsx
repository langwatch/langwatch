import {
  Avatar,
  Box,
  Button,
  Divider,
  FormControl,
  HStack,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Portal,
  Tag,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
  type BoxProps,
} from "@chakra-ui/react";

import { useCallback, useEffect, useMemo } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { HistoryIcon } from "../../components/icons/History";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import isDeepEqual from "fast-deep-equal";
import type { Workflow } from "../types/dsl";
import type { Project } from "@prisma/client";

export function History() {
  const { isOpen, onToggle, onClose } = useDisclosure();

  return (
    <Popover isOpen={isOpen} onClose={onClose} closeOnBlur={false}>
      <PopoverTrigger>
        <Button variant="ghost" color="gray.500" size="xs" onClick={onToggle}>
          <HistoryIcon size={16} />
        </Button>
      </PopoverTrigger>
      <Portal>
        <Box zIndex="popover" position="relative">
          {isOpen && <HistoryPopover onClose={onClose} />}
        </Box>
      </Portal>
    </Popover>
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

  const toast = useToast();

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
          toast({
            title: `Saved version ${version}`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          setWorkflow({
            version,
          });
          void versions.refetch();
        },
        onError: () => {
          toast({
            title: "Error saving version",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
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
    <PopoverContent width="500px">
      <PopoverArrow />
      <PopoverHeader fontWeight={600}>Workflow Versions</PopoverHeader>
      <PopoverCloseButton />
      <PopoverBody padding={0}>
        <form
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onSubmit={form.handleSubmit(onSubmit)}
          style={{ width: "100%", padding: "12px" }}
        >
          <VStack align="start" width="full">
            <NewVersionFields
              form={form}
              nextVersion={nextVersion}
              canSaveNewVersion={canSaveNewVersion}
            />
            <Tooltip label={!canSaveNewVersion ? "No changes to save" : ""}>
              <Button
                type="submit"
                alignSelf="end"
                colorScheme="orange"
                size="sm"
                isLoading={commitVersion.isLoading}
                isDisabled={!canSaveNewVersion}
              >
                Save new version
              </Button>
            </Tooltip>
          </VStack>
        </form>
        <Divider borderBottomWidth="2px" />
        <VStack
          align="start"
          width="full"
          padding={3}
          maxHeight="500px"
          overflowY="auto"
        >
          <Text fontWeight={600} fontSize={16} paddingTop={2}>
            Previous Versions
          </Text>
          {versions.data?.map((version) => (
            <VStack
              key={version.id}
              width="full"
              align="start"
              paddingBottom={2}
            >
              <Divider marginBottom={2} />
              <HStack width="full" spacing={3}>
                <VersionBox version={version} />
                <VStack align="start" width="full" spacing={1}>
                  <HStack>
                    <Text fontWeight={600} fontSize={13} noOfLines={1}>
                      {version.commitMessage}
                    </Text>
                    {version.isCurrentVersion && (
                      <Tag colorScheme="green" size="sm" paddingX={2}>
                        current
                      </Tag>
                    )}
                  </HStack>
                  <HStack>
                    <Avatar
                      name={version.author?.name ?? ""}
                      backgroundColor={"orange.400"}
                      color="white"
                      size="2xs"
                    />
                    <Text fontSize={12}>
                      {version.author?.name}
                      {" · "}
                      <Tooltip
                        label={new Date(version.updatedAt).toLocaleString()}
                      >
                        {formatTimeAgo(version.updatedAt.getTime())}
                      </Tooltip>
                    </Text>
                  </HStack>
                </VStack>
                {!version.isCurrentVersion && (
                  <Tooltip label="Restore this version">
                    <Button
                      variant="ghost"
                      onClick={() => void onRestore(version.id)}
                      isLoading={restoreVersion.isLoading}
                    >
                      <HistoryIcon size={24} />
                    </Button>
                  </Tooltip>
                )}
              </HStack>
            </VStack>
          ))}
        </VStack>
      </PopoverBody>
    </PopoverContent>
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
      padding={3}
      borderRadius={6}
      fontWeight={600}
      fontSize={13}
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

export const hasDSLChange = (
  dslCurrent: Workflow,
  dslPrevious: Workflow,
  includeExecutionStates: boolean
) => {
  const clearDsl = (dsl: Workflow) => {
    return {
      ...dsl,
      version: undefined,
      edges: dsl.edges.map((edge) => {
        const edge_ = { ...edge };
        delete edge_.selected;
        return edge_;
      }),
      nodes: dsl.nodes.map((node) => {
        const node_ = { ...node, data: { ...node.data } };
        delete node_.selected;
        if (!includeExecutionStates) {
          delete node_.data.execution_state;
        }
        return node_;
      }),
      state: includeExecutionStates ? dsl.state : undefined,
    };
  };

  return !isDeepEqual(clearDsl(dslCurrent), clearDsl(dslPrevious));
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
    },
    { enabled: !!project?.id && !!workflowId }
  );
  const currentVersion = versions.data?.find(
    (version) => version.isCurrentVersion
  );
  const latestVersion = versions.data?.find(
    (version) => version.isLatestVersion
  );
  const hasChanges = previousWorkflow
    ? hasDSLChange(getWorkflow(), previousWorkflow, true)
    : false;
  const canSaveNewVersion = !!(
    !!latestVersion?.autoSaved ||
    (allowSaveIfAutoSaveIsCurrentButNotLatest && currentVersion?.autoSaved)
  );

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
  return (
    <HStack width="full">
      <FormControl
        width="fit-content"
        isInvalid={!!form.formState.errors.version}
      >
        <VStack align="start">
          <SmallLabel color="gray.600">Version</SmallLabel>
          <Input
            {...form.register("version", {
              required: true,
              pattern: /^\d+\.\d+$/,
            })}
            placeholder={nextVersion}
            maxWidth="90px"
            pattern="\d+\.\d+"
            isDisabled={!canSaveNewVersion}
          />
        </VStack>
      </FormControl>
      <FormControl
        width="full"
        isInvalid={!!form.formState.errors.commitMessage}
      >
        <VStack align="start" width="full">
          <SmallLabel color="gray.600">Description</SmallLabel>
          <Input
            {...form.register("commitMessage", {
              required: true,
            })}
            placeholder="What changes have you made?"
            width="full"
            isDisabled={!canSaveNewVersion}
          />
        </VStack>
      </FormControl>
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

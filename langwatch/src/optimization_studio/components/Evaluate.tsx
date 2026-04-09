import {
  Button,
  createListCollection,
  HStack,
  Input,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare } from "react-feather";
import {
  Controller,
  type ControllerRenderProps,
  FormProvider,
  type UseFormReturn,
  useForm,
  useWatch,
} from "react-hook-form";
import { SmallLabel } from "../../components/SmallLabel";
import { Dialog } from "../../components/ui/dialog";
import { Select } from "../../components/ui/select";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";
import { useLicenseEnforcement } from "../../hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { useEvaluationExecution } from "../hooks/useEvaluationExecution";
import { useGetDatasetData } from "../hooks/useGetDatasetData";
import { useModelProviderKeys } from "../hooks/useModelProviderKeys";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Entry } from "../types/dsl";
import { trainTestSplit } from "../utils/datasetUtils";
import { AddModelProviderKey } from "./AddModelProviderKey";
import { VersionToBeUsed } from "./VersionToBeUsed";

export function Evaluate() {
  const { open, onToggle, onClose, setOpen } = useDisclosure();

  const { project } = useOrganizationTeamProject();

  const { evaluationState } = useWorkflowStore(({ state }) => ({
    evaluationState: state.evaluation,
  }));

  const isRunning = evaluationState?.status === "running";

  const form = useForm<EvaluateForm>({
    defaultValues: {
      version: "",
      commitMessage: "",
      evaluateOn: undefined,
    },
  });

  return (
    <>
      <Tooltip content={isRunning ? "Evaluation is running" : ""}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            trackEvent("evaluate_click", { project_id: project?.id });
            form.reset({ version: "", commitMessage: "", evaluateOn: undefined });
            onToggle();
          }}
          disabled={isRunning}
        >
          <CheckSquare size={16} /> Evaluate
        </Button>
      </Tooltip>
      <Dialog.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
        {open && <EvaluateModalContent form={form} onClose={onClose} />}
      </Dialog.Root>
    </>
  );
}

type EvaluateForm = {
  version: string;
  commitMessage: string;
  evaluateOn?: DatasetSplitOption;
};

type DatasetSplitOption = {
  label: string;
  value: "full" | "test" | "train" | "specific";
  description: string;
  datasetEntry?: number;
};

export function EvaluateModalContent({
  form,
  onClose,
}: {
  form: UseFormReturn<EvaluateForm>;
  onClose: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const { checkAndProceed } = useLicenseEnforcement("experiments");
  const {
    workflowId,
    getWorkflow,
    evaluationState,
    deselectAllNodes,
    setOpenResultsPanelRequest,
    setLastCommittedWorkflow,
    setCurrentVersionId,
    currentVersionId,
    checkCanCommitNewVersion,
  } = useWorkflowStore(
    ({
      workflow_id: workflowId,
      getWorkflow,
      state,
      deselectAllNodes,
      setOpenResultsPanelRequest,
      setLastCommittedWorkflow,
      setCurrentVersionId,
      currentVersionId,
      checkCanCommitNewVersion,
    }) => ({
      workflowId,
      getWorkflow,
      evaluationState: state.evaluation,
      deselectAllNodes: deselectAllNodes,
      setOpenResultsPanelRequest: setOpenResultsPanelRequest,
      setLastCommittedWorkflow,
      setCurrentVersionId,
      currentVersionId,
      checkCanCommitNewVersion,
    }),
  );

  const { hasProvidersWithoutCustomKeys, nodeProvidersWithoutCustomKeys } =
    useModelProviderKeys({
      workflow: getWorkflow(),
    });

  const entryNode = getWorkflow().nodes.find((node) => node.type === "entry") as
    | Node<Entry>
    | undefined;

  const { total, query: datasetQuery } = useGetDatasetData({
    dataset: entryNode?.data.dataset,
    preview: true,
  });

  const evaluateOn = useWatch({ control: form.control, name: "evaluateOn" });
  const commitMessage = useWatch({ control: form.control, name: "commitMessage" });

  useEffect(() => {
    if (!evaluateOn) {
      form.setValue(
        "evaluateOn",
        total && total > 50 ? splitOptions[1]! : splitOptions[0]!,
      );
    }
  }, [form, total, evaluateOn]);

  const datasetName = entryNode?.data.dataset?.name;
  const trainSize = entryNode?.data.train_size ?? 0.8;
  const testSize = entryNode?.data.test_size ?? 0.2;
  const isPercentage = trainSize < 1 || testSize < 1;

  const { train, test } = trainTestSplit(
    Array.from({ length: total ?? 0 }, (_, i) => i),
    {
      trainSize,
      testSize,
    },
  );
  const splitOptions: DatasetSplitOption[] = [
    {
      label: "Full dataset",
      value: "full",
      description: `Full ${datasetName} dataset`,
    },
    {
      label: "Test entries",
      value: "test",
      description: isPercentage
        ? `${Math.round(testSize * 100)}% of ${datasetName} dataset`
        : `${test.length} entries`,
    },
    {
      label: "Train entries",
      value: "train",
      description: isPercentage
        ? `${Math.round(trainSize * 100)}% of ${datasetName} dataset`
        : `${train.length} entries`,
    },
    {
      label: "Specific entry",
      value: "specific",
      description: `Specific entry from ${datasetName} dataset`,
    },
  ];

  const estimatedTotal = useMemo(() => {
    if (evaluateOn?.value === "full") {
      return total;
    }
    if (evaluateOn?.value === "test") {
      return test.length;
    }
    if (evaluateOn?.value === "train") {
      return train.length;
    }
    if (evaluateOn?.value === "specific") {
      return 1;
    }
    return 0;
  }, [evaluateOn, total, train.length, test.length]);

  const canSave = checkCanCommitNewVersion();
  const trpc = api.useContext();

  const commitVersion = api.workflow.commitVersion.useMutation();
  const { startEvaluationExecution } = useEvaluationExecution();

  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (hasStarted && evaluationState?.status === "running") {
      onClose();
      deselectAllNodes();
      setOpenResultsPanelRequest("evaluations");
    }
  }, [
    evaluationState?.status,
    hasStarted,
    onClose,
    deselectAllNodes,
    setOpenResultsPanelRequest,
  ]);

  const onSubmit = useCallback(
    async ({ version, commitMessage, evaluateOn }: EvaluateForm) => {
      if (!project || !workflowId) return;

      if (!estimatedTotal) {
        return;
      }

      if (!evaluateOn) {
        return;
      }

      if (
        estimatedTotal >= 300 &&
        !confirm(`Going to evaluate ${estimatedTotal} entries. Are you sure?`)
      ) {
        return;
      }

      if (estimatedTotal >= 5000) {
        alert(
          "A maximum of 5000 entries can be evaluated at a time. Please contact support if you need to evaluate more.",
        );
        return;
      }

      await checkAndProceed(async () => {
        let versionId: string | undefined;

        if (canSave) {
          try {
            const versionResponse = await commitVersion.mutateAsync({
              projectId: project.id,
              workflowId,
              commitMessage,
              dsl: {
                ...getWorkflow(),
                version,
              },
            });
            versionId = versionResponse.id;
            setLastCommittedWorkflow(getWorkflow());
            setCurrentVersionId(versionId);
          } catch (error) {
            toaster.create({
              title: "Error saving version",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
            throw error;
          }
        } else {
          versionId = currentVersionId;
        }

        if (!versionId) {
          toaster.create({
            title: "Version ID not found for evaluation",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
          return;
        }

        void trpc.workflow.getVersions.invalidate();

        startEvaluationExecution({
          workflow_version_id: versionId,
          evaluate_on: evaluateOn.value,
          dataset_entry:
            evaluateOn.value === "specific" ? evaluateOn.datasetEntry : undefined,
        });
        setHasStarted(true);
      });
    },
    [
      canSave,
      checkAndProceed,
      commitVersion,
      currentVersionId,
      estimatedTotal,
      getWorkflow,
      project,
      setCurrentVersionId,
      setLastCommittedWorkflow,
      startEvaluationExecution,
      trpc.workflow.getVersions,
      workflowId,
    ],
  );

  const isRunning = evaluationState?.status === "running";

  if (isRunning) {
    return null;
  }

  const needsACommitMessage = canSave && !commitMessage;

  const isDatasetLoading = total === undefined && datasetQuery.isFetching;

  const isDisabled = hasProvidersWithoutCustomKeys
    ? "Set up your API keys to run evaluations"
    : isDatasetLoading
      ? false
      : !estimatedTotal || estimatedTotal < 1
        ? "You need at least 1 dataset entry to run evaluations"
        : needsACommitMessage
          ? "You need to provide a version description"
          : false;

  return (
    <FormProvider {...form}>
    <Dialog.Content
      as="form"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={form.handleSubmit(onSubmit)}
      borderTop="5px solid"
      borderTopColor="green.400"
    >
      <Dialog.Header>
        <Dialog.Title fontWeight={600}>Evaluate Workflow</Dialog.Title>
        <Dialog.CloseTrigger />
      </Dialog.Header>
      <Dialog.Body>
        <VStack align="start" width="full" gap={4}>
          <VStack align="start" width="full">
            <VersionToBeUsed />
          </VStack>
          <VStack align="start" width="full" gap={2}>
            <SmallLabel>Evaluate on</SmallLabel>
            <Controller
              control={form.control}
              name="evaluateOn"
              rules={{ required: "Evaluate on is required" }}
              render={({ field }) => (
                <DatasetSplitSelect
                  field={field}
                  options={splitOptions}
                  total={total}
                />
              )}
            />
          </VStack>
        </VStack>
      </Dialog.Body>
      <Dialog.Footer borderTop="1px solid" borderColor="border" marginTop={4}>
        <VStack align="start" width="full" gap={3}>
          {hasProvidersWithoutCustomKeys && (
            <AddModelProviderKey
              runWhat="run evaluations"
              nodeProvidersWithoutCustomKeys={nodeProvidersWithoutCustomKeys}
            />
          )}
          <HStack width="full">
            <Text fontWeight={500}>
              {isDatasetLoading ? "Loading dataset..." : `${estimatedTotal ?? 0} entries`}
            </Text>
            <Spacer />
            <Tooltip content={isDisabled}>
              <Button
                variant="outline"
                type="submit"
                disabled={!!isDisabled}
                loading={
                  isDatasetLoading ||
                  commitVersion.isLoading ||
                  evaluationState?.status === "waiting"
                }
              >
                <CheckSquare size={16} />
                {canSave ? "Save & Run Evaluation" : "Run Evaluation"}
              </Button>
            </Tooltip>
          </HStack>
        </VStack>
      </Dialog.Footer>
    </Dialog.Content>
    </FormProvider>
  );
}

const DatasetSplitSelect = ({
  field,
  options,
  total,
}: {
  field: ControllerRenderProps<EvaluateForm, "evaluateOn">;
  options: DatasetSplitOption[];
  total?: number;
}) => {
  const datasetSplitCollection = createListCollection({
    items: options,
  });

  return (
    <VStack width="100%" gap={2}>
      <Select.Root
        {...field}
        collection={datasetSplitCollection}
        value={field.value?.value ? [field.value.value] : []}
        onChange={undefined}
        onValueChange={(change) => {
          const selectedOption = options.find(
            (option) => option.value === change.value[0],
          );
          field.onChange({
            target: {
              name: field.name,
              value: selectedOption,
            },
          });
        }}
        width="100%"
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Select dataset split" />
        </Select.Trigger>
        <Select.Content>
          {options.map((option) => (
            <Select.Item item={option} key={option.value}>
              <VStack align="start" width="full">
                <Text>{option.label}</Text>
                <Text fontSize="13px" color="fg.muted">
                  {option.description}
                </Text>
              </VStack>
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      {field.value?.value === "specific" && (
        <Input
          type="text"
          placeholder={`Enter row index (0-${(total ?? 0) - 1})`}
          value={String(field.value.datasetEntry ?? "")}
          onChange={(e) => {
            const input = e.target.value;
            if (input === "" || /^[0-9]*$/.test(input)) {
              const value = input === "" ? undefined : parseInt(input);
              field.onChange({
                target: {
                  name: field.name,
                  value: {
                    ...field.value,
                    datasetEntry: value,
                    label:
                      value !== undefined ? `Entry ${value}` : "Specific entry",
                  },
                },
              });
            }
          }}
        />
      )}
    </VStack>
  );
};

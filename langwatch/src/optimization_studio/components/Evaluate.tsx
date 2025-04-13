import {
  Button,
  HStack,
  Skeleton,
  Spacer,
  Text,
  useDisclosure,
  VStack,
  createListCollection,
  Portal,
} from "@chakra-ui/react";
import { Select } from "../../components/ui/select";
import { Dialog } from "../../components/ui/dialog";
import { Tooltip } from "../../components/ui/tooltip";

import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare } from "react-feather";
import {
  Controller,
  useForm,
  type ControllerRenderProps,
  type UseControllerProps,
  type UseFormReturn,
} from "react-hook-form";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useEvaluationExecution } from "../hooks/useEvaluationExecution";
import { useGetDatasetData } from "../hooks/useGetDatasetData";
import { useModelProviderKeys } from "../hooks/useModelProviderKeys";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Entry } from "../types/dsl";
import { AddModelProviderKey } from "./AddModelProviderKey";
import { useVersionState, VersionToBeUsed } from "./History";
import { trainTestSplit } from "../utils/datasetUtils";
import { trackEvent } from "../../utils/tracking";
import { toaster } from "../../components/ui/toaster";

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
  value: "full" | "test" | "train";
  description: string;
};

export function EvaluateModalContent({
  form,
  onClose,
}: {
  form: UseFormReturn<EvaluateForm>;
  onClose: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const { hasProvidersWithoutCustomKeys, nodeProvidersWithoutCustomKeys } =
    useModelProviderKeys();
  const {
    workflowId,
    getWorkflow,
    evaluationState,
    deselectAllNodes,
    setOpenResultsPanelRequest,
  } = useWorkflowStore(
    ({
      workflow_id: workflowId,
      getWorkflow,
      state,
      deselectAllNodes,
      setOpenResultsPanelRequest,
    }) => ({
      workflowId,
      getWorkflow,
      evaluationState: state.evaluation,
      deselectAllNodes: deselectAllNodes,
      setOpenResultsPanelRequest: setOpenResultsPanelRequest,
    })
  );

  const entryNode = getWorkflow().nodes.find(
    (node) => node.type === "entry"
  ) as Node<Entry> | undefined;

  const { total } = useGetDatasetData({
    dataset: entryNode?.data.dataset,
    preview: true,
  });

  const evaluateOn = form.watch("evaluateOn");
  const commitMessage = form.watch("commitMessage");

  useEffect(() => {
    if (!evaluateOn) {
      form.setValue(
        "evaluateOn",
        total && total > 50 ? splitOptions[1]! : splitOptions[0]!
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
    }
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
    return 0;
  }, [evaluateOn, total, train.length, test.length]);

  const { versions, canSaveNewVersion, nextVersion, versionToBeEvaluated } =
    useVersionState({
      project,
      form: form as unknown as UseFormReturn<{
        version: string;
        commitMessage: string;
      }>,
      allowSaveIfAutoSaveIsCurrentButNotLatest: false,
    });

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

      let versionId: string | undefined = versionToBeEvaluated.id;

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
          "A maximum of 5000 entries can be evaluated at a time. Please contact support if you need to evaluate more."
        );
        return;
      }

      if (canSaveNewVersion) {
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
        } catch (error) {
          toaster.create({
            title: "Error saving version",
            type: "error",
            duration: 5000,
            meta: { closable: true },
            placement: "top-end",
          });
          throw error;
        }
      }

      if (!versionId) {
        toaster.create({
          title: "Version ID not found for evaluation",
          type: "error",
          duration: 5000,
          meta: { closable: true },
          placement: "top-end",
        });
        return;
      }

      void versions.refetch();

      startEvaluationExecution({
        workflow_version_id: versionId,
        evaluate_on: evaluateOn.value,
      });
      setHasStarted(true);
    },
    [
      canSaveNewVersion,
      commitVersion,
      estimatedTotal,
      getWorkflow,
      project,
      startEvaluationExecution,
      versionToBeEvaluated.id,
      versions,
      workflowId,
    ]
  );

  const isRunning = evaluationState?.status === "running";

  if (isRunning) {
    return null;
  }

  if (!versions.data) {
    return (
      <Dialog.Content borderTop="5px solid" borderTopColor="green.400">
        <Dialog.Header>
          <Dialog.Title fontWeight={600}>Evaluate Workflow</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer />
      </Dialog.Content>
    );
  }

  const needsACommitMessage = canSaveNewVersion && !commitMessage;

  const isDisabled = hasProvidersWithoutCustomKeys
    ? "Set up your API keys to run evaluations"
    : !estimatedTotal || estimatedTotal < 1
    ? "You need at least 1 dataset entry to run evaluations"
    : needsACommitMessage
    ? "You need to provide a version description"
    : false;

  return (
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
            <VersionToBeUsed
              form={
                form as unknown as UseFormReturn<{
                  version: string;
                  commitMessage: string;
                }>
              }
              nextVersion={nextVersion}
              canSaveNewVersion={canSaveNewVersion}
              versionToBeEvaluated={versionToBeEvaluated}
            />
          </VStack>
          <VStack align="start" width="full" gap={2}>
            <SmallLabel color="gray.600">Evaluate on</SmallLabel>
            <Controller
              control={form.control}
              name="evaluateOn"
              rules={{ required: "Evaluate on is required" }}
              render={({ field }) => (
                <DatasetSplitSelect field={field} options={splitOptions} />
              )}
            />
          </VStack>
        </VStack>
      </Dialog.Body>
      <Dialog.Footer borderTop="1px solid" borderColor="gray.200" marginTop={4}>
        <VStack align="start" width="full" gap={3}>
          {hasProvidersWithoutCustomKeys && (
            <AddModelProviderKey
              runWhat="run evaluations"
              nodeProvidersWithoutCustomKeys={nodeProvidersWithoutCustomKeys}
            />
          )}
          <HStack width="full">
            <Text fontWeight={500}>{estimatedTotal} entries</Text>
            <Spacer />
            <Tooltip content={isDisabled}>
              <Button
                variant="outline"
                type="submit"
                disabled={!!isDisabled}
                loading={
                  commitVersion.isLoading ||
                  evaluationState?.status === "waiting"
                }
              >
                <CheckSquare size={16} />
                {canSaveNewVersion ? "Save & Run Evaluation" : "Run Evaluation"}
              </Button>
            </Tooltip>
          </HStack>
        </VStack>
      </Dialog.Footer>
    </Dialog.Content>
  );
}

const DatasetSplitSelect = ({
  field,
  options,
}: {
  field: ControllerRenderProps<EvaluateForm, "evaluateOn">;
  options: DatasetSplitOption[];
}) => {
  const datasetSplitCollection = createListCollection({
    items: options,
  });

  return (
    <Select.Root
      {...field}
      collection={datasetSplitCollection}
      value={field.value?.value ? [field.value.value] : []}
      onChange={undefined}
      onValueChange={(change) => {
        const selectedOption = options.find(
          (option) => option.value === change.value[0]
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
      <Select.Content zIndex="popover">
        {options.map((option) => (
          <Select.Item item={option} key={option.value}>
            <VStack align="start" width="full">
              <Text>{option.label}</Text>
              <Text fontSize="13px" color="gray.500">
                {option.description}
              </Text>
            </VStack>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
};

import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Skeleton,
  Spacer,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";

import type { Node } from "@xyflow/react";
import { chakraComponents, Select as MultiSelect } from "chakra-react-select";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare } from "react-feather";
import {
  Controller,
  useForm,
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

export function Evaluate() {
  const { isOpen, onToggle, onClose } = useDisclosure();

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
      <Tooltip label={isRunning ? "Evaluation is running" : ""}>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggle}
          leftIcon={<CheckSquare size={16} />}
          isDisabled={isRunning}
        >
          Evaluate
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        {isOpen && <EvaluateModalContent form={form} onClose={onClose} />}
      </Modal>
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

  const toast = useToast();
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
          toast({
            title: "Error saving version",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          throw error;
        }
      }

      if (!versionId) {
        toast({
          title: "Version ID not found for evaluation",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
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
      toast,
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
      <ModalContent borderTop="5px solid" borderColor="green.400">
        <ModalHeader fontWeight={600}>Evaluate Workflow</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="start" width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        </ModalBody>
        <ModalFooter />
      </ModalContent>
    );
  }

  const isDisabled = hasProvidersWithoutCustomKeys
    ? "Set up your API keys to run evaluations"
    : !estimatedTotal || estimatedTotal < 1
    ? "You need at least 1 dataset entry to run evaluations"
    : false;

  return (
    <ModalContent
      as="form"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={form.handleSubmit(onSubmit)}
      borderTop="5px solid"
      borderColor="green.400"
    >
      <ModalHeader fontWeight={600}>Evaluate Workflow</ModalHeader>
      <ModalCloseButton />
      <ModalBody>
        <VStack align="start" width="full" spacing={4}>
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
          <VStack align="start" width="full" spacing={2}>
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
      </ModalBody>
      <ModalFooter borderTop="1px solid" borderColor="gray.200" marginTop={4}>
        <VStack align="start" width="full" spacing={3}>
          {hasProvidersWithoutCustomKeys && (
            <AddModelProviderKey
              nodeProvidersWithoutCustomKeys={nodeProvidersWithoutCustomKeys}
            />
          )}
          <HStack width="full">
            <Text fontWeight={500}>{estimatedTotal} entries</Text>
            <Spacer />
            <Tooltip label={isDisabled}>
              <Button
                variant="outline"
                type="submit"
                leftIcon={<CheckSquare size={16} />}
                isLoading={
                  commitVersion.isLoading ||
                  evaluationState?.status === "waiting"
                }
                isDisabled={!!isDisabled}
              >
                {canSaveNewVersion ? "Save & Run Evaluation" : "Run Evaluation"}
              </Button>
            </Tooltip>
          </HStack>
        </VStack>
      </ModalFooter>
    </ModalContent>
  );
}

const DatasetSplitSelect = ({
  field,
  options,
}: {
  field: UseControllerProps<EvaluateForm>;
  options: DatasetSplitOption[];
}) => {
  return (
    <MultiSelect
      {...field}
      options={options}
      hideSelectedOptions={false}
      isSearchable={false}
      useBasicStyles
      chakraStyles={{
        container: (base) => ({
          ...base,
          background: "white",
          width: "100%",
          borderRadius: "5px",
        }),
      }}
      components={{
        Menu: ({ children, ...props }) => (
          <chakraComponents.Menu
            {...props}
            innerProps={{
              ...props.innerProps,
            }}
          >
            {children}
          </chakraComponents.Menu>
        ),
        Option: ({ children, ...props }) => (
          <chakraComponents.Option {...props}>
            <VStack align="start">
              <Text>{children}</Text>
              <Text
                color={props.isSelected ? "white" : "gray.500"}
                fontSize={13}
              >
                {(props.data as any).description}
              </Text>
            </VStack>
          </chakraComponents.Option>
        ),
      }}
    />
  );
};

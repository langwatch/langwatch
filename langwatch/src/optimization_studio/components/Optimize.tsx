import {
  Button,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Skeleton,
  Spacer,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";

import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Info, TrendingUp } from "react-feather";
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
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Entry } from "../types/dsl";
import { NewVersionFields, useVersionState } from "./History";
import { VersionToBeEvaluated } from "./Evaluate";
import { useOptimizationExecution } from "../hooks/useOptimizationExecution";
import { OPTIMIZERS } from "../types/optimizers";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";

const optimizerOptions: {
  label: string;
  value: keyof typeof OPTIMIZERS;
  description: string;
}[] = Object.entries(OPTIMIZERS).map(([key, optimizer]) => ({
  label: key,
  value: key as keyof typeof OPTIMIZERS,
  description: optimizer.description,
}));

export function Optimize() {
  const { isOpen, onToggle, onClose } = useDisclosure();

  const { optimizationState } = useWorkflowStore(({ state }) => ({
    optimizationState: state.optimization,
  }));

  const isRunning = optimizationState?.status === "running";

  return (
    <>
      <Tooltip label={isRunning ? "Optimization is running" : ""}>
        <Button
          colorScheme="green"
          size="sm"
          onClick={onToggle}
          leftIcon={<TrendingUp size={16} />}
          isDisabled={isRunning}
        >
          Optimize
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        {isOpen && <OptimizeModalContent onClose={onClose} />}
      </Modal>
    </>
  );
}

type OptimizeForm = {
  version: string;
  commitMessage: string;
  optimizer: (typeof optimizerOptions)[number];
  params: (typeof OPTIMIZERS)[keyof typeof OPTIMIZERS]["params"];
};

export function OptimizeModalContent({ onClose }: { onClose: () => void }) {
  const { project } = useOrganizationTeamProject();
  const {
    workflowId,
    getWorkflow,
    optimizationState,
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
      optimizationState: state.optimization,
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

  const form = useForm<OptimizeForm>({
    defaultValues: {
      version: "",
      commitMessage: "",
      optimizer: optimizerOptions[0]!,
      params: {},
    },
  });

  const optimizer = OPTIMIZERS[form.watch("optimizer").value];

  useEffect(() => {
    if (!optimizer) return;
    form.setValue("params", optimizer.params);
  }, [form, optimizer]);

  const [trainTotal, testTotal] = useMemo(() => {
    const testTotal = Math.ceil(
      (total ?? 0) * (entryNode?.data.train_test_split ?? 0)
    );
    const trainTotal = Math.floor(
      (total ?? 0) * (1 - (entryNode?.data.train_test_split ?? 0))
    );
    return [trainTotal, testTotal];
  }, [total, entryNode?.data.train_test_split]);

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
  const { startOptimizationExecution } = useOptimizationExecution();

  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (hasStarted && optimizationState?.status === "running") {
      onClose();
      deselectAllNodes();
      setOpenResultsPanelRequest("optimizations");
    }
  }, [
    optimizationState?.status,
    hasStarted,
    onClose,
    deselectAllNodes,
    setOpenResultsPanelRequest,
  ]);

  const onSubmit = useCallback(
    async ({ version, commitMessage, optimizer, params }: OptimizeForm) => {
      if (!project || !workflowId) return;

      let versionId: string | undefined = versionToBeEvaluated.id;

      if (!trainTotal || !testTotal) {
        return;
      }

      if (
        trainTotal >= 300 &&
        !confirm(`Going to optimize on ${trainTotal} entries. Are you sure?`)
      ) {
        return;
      }

      if (trainTotal + testTotal >= 5000) {
        alert(
          "Optimiziation is limited to a maximum of 5000 entries total. Please contact support if you need to optimize on more."
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
          title: "Version ID not found for optimization",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
        return;
      }

      startOptimizationExecution({
        workflow_version_id: versionId,
        optimizer: optimizer.value,
        params,
      });
      setHasStarted(true);
    },
    [
      canSaveNewVersion,
      commitVersion,
      getWorkflow,
      project,
      startOptimizationExecution,
      testTotal,
      toast,
      trainTotal,
      versionToBeEvaluated.id,
      workflowId,
    ]
  );

  const isRunning = optimizationState?.status === "running";

  if (isRunning) {
    return null;
  }

  if (!versions.data) {
    return (
      <ModalContent borderTop="5px solid" borderColor="green.400">
        <ModalHeader fontWeight={600}>Optimize Workflow</ModalHeader>
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

  return (
    <ModalContent
      as="form"
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSubmit={form.handleSubmit(onSubmit)}
      borderTop="5px solid"
      borderColor="green.400"
    >
      <ModalHeader fontWeight={600}>Optimize Workflow</ModalHeader>
      <ModalCloseButton />
      <ModalBody display="flex" flexDirection="column" gap={4}>
        <VStack align="start" width="full" spacing={4}>
          <VStack align="start" width="full">
            <VersionToBeEvaluated
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
            <SmallLabel color="gray.600">Optimizer</SmallLabel>
            <Controller
              control={form.control}
              name="optimizer"
              rules={{ required: "Optimizer is required" }}
              render={({ field }) => <OptimizerSelect field={field} />}
            />
          </VStack>
        </VStack>
        <HStack>
          {"max_labeled_demos" in optimizer.params && (
            <VStack align="start" width="full" spacing={2}>
              <HStack>
                <SmallLabel color="gray.600">Max Labeled Demos</SmallLabel>
                <Tooltip label="Maximum number of few shot demonstrations comming from the original dataset, those are more reliable because they come from the training set">
                  <Info size={16} />
                </Tooltip>
              </HStack>
              <Input
                {...form.register("params.max_labeled_demos")}
                type="number"
                min={1}
                max={100}
              />
            </VStack>
          )}
          {"max_bootstrapped_demos" in optimizer.params && (
            <VStack align="start" width="full" spacing={2}>
              <HStack>
                <SmallLabel color="gray.600">Max Bootstrapped Demos</SmallLabel>
                <Tooltip label="Maximum number of few shot demonstrations generated on the fly by the optimizer, those may be less reliable because they are generated by the LLM">
                  <Info size={16} />
                </Tooltip>
              </HStack>
              <Input
                {...form.register("params.max_bootstrapped_demos")}
                type="number"
                min={1}
                max={100}
              />
            </VStack>
          )}
        </HStack>
        {"max_rounds" in optimizer.params && (
          <VStack align="start" width="full" spacing={2}>
            <SmallLabel color="gray.600">Max Rounds</SmallLabel>
            <Input
              {...form.register("params.max_rounds")}
              type="number"
              min={1}
              max={100}
            />
          </VStack>
        )}
      </ModalBody>
      <ModalFooter borderTop="1px solid" borderColor="gray.200" marginTop={4}>
        <HStack width="full">
          <VStack align="start" spacing={0}>
            <Text fontWeight={500}>{trainTotal + testTotal} entries</Text>
            <Text whiteSpace="nowrap" fontSize="13px">
              ({trainTotal} train / {testTotal} test)
            </Text>
          </VStack>
          <Spacer />
          <Button
            variant="outline"
            type="submit"
            leftIcon={<CheckSquare size={16} />}
            isLoading={optimizationState?.status === "waiting"}
          >
            {canSaveNewVersion ? "Save & Run Optimization" : "Run Optimization"}
          </Button>
        </HStack>
      </ModalFooter>
    </ModalContent>
  );
}

const OptimizerSelect = ({
  field,
}: {
  field: UseControllerProps<OptimizeForm>;
}) => {
  return (
    <MultiSelect
      {...field}
      options={optimizerOptions}
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

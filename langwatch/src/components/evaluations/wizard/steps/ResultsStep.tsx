import { Button, Heading, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useForm } from "react-hook-form";
import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";
import {
  EXECUTION_METHODS,
  TASK_TYPES,
  useEvaluationWizardStore,
  type Step,
} from "~/hooks/useEvaluationWizardStore";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../utils/api";
import { FullWidthFormControl } from "../../../FullWidthFormControl";

export function ResultsStep() {
  const { name, setWizardState } = useEvaluationWizardStore(
    ({ wizardState, setWizardState }) => ({
      name: wizardState.name,
      setWizardState,
    })
  );

  const form = useForm<{
    name: string;
  }>({
    defaultValues: {
      name: name ?? "",
    },
  });

  const onSubmit = (data: { name: string }) => {
    setWizardState({ name: data.name });
  };

  return (
    <>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          Test it out!
        </Heading>
        <Text>Review, see the results, iterate</Text>
      </VStack>
      <VStack width="full" align="start" gap={4}>
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
          <FullWidthFormControl
            label="Evaluation Name"
            invalid={form.formState.errors.name !== undefined}
          >
            <Input
              {...form.register("name")}
              // eslint-disable-next-line @typescript-eslint/no-misused-promises
              onBlur={form.handleSubmit(onSubmit)}
            />
          </FullWidthFormControl>
        </form>
        <Heading as="h2" size="md">
          Configuration Summary
        </Heading>
        <VStack width="full" align="start" gap={4}>
          <StepStatus name="Task" step="task" />
          <StepStatus name="Dataset" step="dataset" />
          <StepStatus
            name="Execution"
            step="execution"
            action="execution method"
          />
          <StepStatus name="Evaluation" step="evaluation" />
        </VStack>
      </VStack>
    </>
  );
}

export const useStepCompletedValue = () => {
  const { project } = useOrganizationTeamProject();

  const { wizardState, datasetId, evaluator } = useEvaluationWizardStore(
    ({ wizardState, setWizardState, getDatasetId, getFirstEvaluatorNode }) => ({
      wizardState,
      setWizardState,
      datasetId: getDatasetId(),
      evaluator: getFirstEvaluatorNode(),
    })
  );

  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    }
  );

  return (step: Step) => {
    switch (step) {
      case "task":
        return wizardState.task ? TASK_TYPES[wizardState.task] : undefined;
      case "dataset":
        return databaseDataset?.data?.name;
      case "execution":
        return wizardState.task === "real_time"
          ? "When message arrives"
          : wizardState.executionMethod
          ? EXECUTION_METHODS[wizardState.executionMethod]
          : undefined;
      case "evaluation":
        return evaluator?.data?.name;
      case "results":
        return true;
      default:
        step satisfies never;
        return undefined;
    }
  };
};

function StepStatus({
  name,
  action: action_,
  step,
}: {
  name: string;
  action?: string;
  step: Step;
}) {
  const { setWizardState } = useEvaluationWizardStore(({ setWizardState }) => ({
    setWizardState,
  }));

  const stepCompletedValue = useStepCompletedValue();
  const value = stepCompletedValue(step);
  const action = action_ ?? step;

  return (
    <Button
      onClick={() => setWizardState({ step })}
      variant="plain"
      padding={0}
      width="full"
      height="auto"
      justifyContent="start"
      _icon={{
        color: value ? "green.400" : "yellow.500",
        maxWidth: "20px",
        maxHeight: "20px",
        width: "20px",
        height: "20px",
      }}
      asChild
    >
      <HStack width="full" align="start" gap={4}>
        {value ? <LuCircleCheck /> : <LuCircleAlert />}
        <VStack align="start" gap={1}>
          <Text fontWeight="medium" fontSize="14px">
            {name}
          </Text>
          <Text fontSize="13px" fontWeight="normal">
            {value ?? `No ${action} selected`}
          </Text>
        </VStack>
      </HStack>
    </Button>
  );
}

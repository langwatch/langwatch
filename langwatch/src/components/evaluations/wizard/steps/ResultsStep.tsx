import {
  Button,
  Circle,
  Heading,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useForm } from "react-hook-form";
import {
  DATA_SOURCE_TYPES,
  EXECUTION_METHODS,
  TASK_TYPES,
  useEvaluationWizardStore,
  type Step,
} from "~/hooks/useEvaluationWizardStore";
import { HorizontalFormControl } from "../../../HorizontalFormControl";
import { FullWidthFormControl } from "../../../FullWidthFormControl";
import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";
import { api } from "../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";

export function ResultsStep() {
  const { project } = useOrganizationTeamProject();
  const { wizardState, setWizardState, datasetId, evaluator } =
    useEvaluationWizardStore(
      ({
        wizardState,
        setWizardState,
        getDatasetId,
        getFirstEvaluatorNode,
      }) => ({
        wizardState,
        setWizardState,
        datasetId: getDatasetId(),
        evaluator: getFirstEvaluatorNode(),
      })
    );

  const form = useForm<{
    name: string;
  }>({
    defaultValues: {
      name: "",
    },
  });

  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    }
  );

  const onSubmit = (data: { name: string }) => {
    console.log(data);
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
            <Input {...form.register("name")} />
          </FullWidthFormControl>
        </form>
        <Heading as="h2" size="md">
          Configuration Summary
        </Heading>
        <VStack width="full" align="start" gap={4}>
          <StepStatus
            name="Task"
            action="task"
            step="task"
            value={wizardState.task ? TASK_TYPES[wizardState.task] : undefined}
          />
          <StepStatus
            name="Dataset"
            action="dataset"
            step="dataset"
            value={databaseDataset?.data?.name}
          />
          <StepStatus
            name="Execution"
            action="execution method"
            step="execution"
            value={
              wizardState.task === "real_time"
                ? "When message arrives"
                : wizardState.executionMethod
                ? EXECUTION_METHODS[wizardState.executionMethod]
                : undefined
            }
          />
          <StepStatus
            name="Evaluation"
            action="evaluation"
            step="evaluation"
            value={evaluator?.data?.name}
          />
        </VStack>
      </VStack>
    </>
  );
}

function StepStatus({
  name,
  action,
  step,
  value,
}: {
  name: string;
  action: string;
  step: Step;
  value?: string;
}) {
  const { setWizardState } = useEvaluationWizardStore(({ setWizardState }) => ({
    setWizardState,
  }));

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

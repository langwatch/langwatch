import {
  Alert,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";
import {
  useEvaluationWizardStore,
  type Step,
} from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { FullWidthFormControl } from "../../../FullWidthFormControl";
import { Tooltip } from "../../../ui/tooltip";
import { RunEvaluationButton } from "../components/RunTrialEvaluationButton";
import { useStepCompletedValue } from "../hooks/useStepCompletedValue";
import { useModelProviderKeys } from "../../../../optimization_studio/hooks/useModelProviderKeys";
import { AddModelProviderKey } from "../../../../optimization_studio/components/AddModelProviderKey";
import { Link } from "../../../ui/link";

export function ResultsStep() {
  const { name, wizardState, setWizardState, getDSL } =
    useEvaluationWizardStore(({ wizardState, setWizardState, getDSL }) => ({
      name: wizardState.name,
      wizardState,
      setWizardState,
      getDSL,
    }));

  const { hasProvidersWithoutCustomKeys, nodeProvidersWithoutCustomKeys } =
    useModelProviderKeys({
      workflow: getDSL(),
    });

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

  const stepCompletedValue = useStepCompletedValue();

  useEffect(() => {
    setWizardState({ workspaceTab: "results" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              autoFocus
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
        {hasProvidersWithoutCustomKeys && (
          <AddModelProviderKey
            runWhat="run evaluations"
            nodeProvidersWithoutCustomKeys={nodeProvidersWithoutCustomKeys}
          />
        )}
        {wizardState.executionMethod?.startsWith("realtime") && (
          <Alert.Root colorPalette="blue">
            <Alert.Content>
              <Alert.Description>
                <VStack align="start" gap={4}>
                  {stepCompletedValue("dataset") ? (
                    <>
                      Try out your real-time evaluation with the sample before
                      enabling monitoring.
                    </>
                  ) : (
                    <Box>
                      <Link
                        href="#"
                        textDecoration="underline"
                        onClick={() => setWizardState({ step: "dataset" })}
                      >
                        Select a dataset
                      </Link>{" "}
                      to try out your real-time evaluation with the sample
                      before enabling monitoring.
                    </Box>
                  )}
                  <RunEvaluationButton isTrial colorPalette="blue">
                    Run Trial Evaluation
                  </RunEvaluationButton>
                </VStack>
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
      </VStack>
    </>
  );
}

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
        minWidth: "20px",
        maxWidth: "20px",
        minHeight: "20px",
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
          <Text fontSize="13px" fontWeight="normal" lineClamp={1}>
            {value ?? `No ${action} selected`}
          </Text>
        </VStack>
      </HStack>
    </Button>
  );
}

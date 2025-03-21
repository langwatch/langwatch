import { Heading, RadioCard, Text, VStack } from "@chakra-ui/react";
import { Activity, Edit3 } from "react-feather";
import { LuBadgeCheck, LuListChecks, LuShield } from "react-icons/lu";
import {
  TASK_TYPES,
  useEvaluationWizardStore,
  type State,
} from "~/hooks/useEvaluationWizardStore";
import { ColorfulBlockIcon } from "../../../../optimization_studio/components/ColorfulBlockIcons";
import { StepButton } from "../components/StepButton";

export function TaskStep() {
  const { wizardState, setWizardState } = useEvaluationWizardStore();

  const handleTaskSelection = (task: State["wizardState"]["task"]) => {
    setWizardState({
      step: "dataset",
      task,
    });
  };

  return (
    <>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          What are you trying to do?
        </Heading>
        <Text>Select what evaluation flow you want to follow</Text>
      </VStack>
      <RadioCard.Root
        value={wizardState.task}
        onValueChange={(e) =>
          handleTaskSelection(e.value as State["wizardState"]["task"])
        }
      >
        <VStack width="full" gap={3}>
          <StepButton
            colorPalette="green"
            value="real_time"
            title={TASK_TYPES.real_time}
            description="Evaluate messages as they arrive in production"
            onClick={() => handleTaskSelection("real_time")}
            icon={
              <ColorfulBlockIcon
                color="green.400"
                size="md"
                icon={<Activity />}
                marginTop="-2px"
              />
            }
          />
          <StepButton
            colorPalette="blue"
            value="llm_app"
            title={TASK_TYPES.llm_app}
            description="Run a batch evaluation of dataset examples against your existing LLM application"
            // Disabled for now
            // onClick={() => handleTaskSelection("llm_app")}
            disabled
            icon={
              <ColorfulBlockIcon
                color="blue.400"
                size="md"
                icon={<LuListChecks />}
                marginTop="-2px"
              />
            }
          />
          <StepButton
            colorPalette="purple"
            value="prompt_creation"
            title={TASK_TYPES.prompt_creation}
            description="Build a new prompt and evaluate the quality of the outputs, iteratively improving it"
            // Disabled for now
            // onClick={() => handleTaskSelection("prompt_creation")}
            disabled
            icon={
              <ColorfulBlockIcon
                color="purple.400"
                size="md"
                icon={<Edit3 />}
                marginTop="-2px"
              />
            }
          />
          <StepButton
            colorPalette="orange"
            value="custom_evaluator"
            title={TASK_TYPES.custom_evaluator}
            description="Build your own reliable evaluator to be used by other flows, measuring and ensuring its accuracy"
            // Disabled for now
            // onClick={() => handleTaskSelection("custom_evaluator")}
            disabled
            icon={
              <ColorfulBlockIcon
                color="orange.400"
                size="md"
                icon={<LuBadgeCheck />}
                marginTop="-2px"
              />
            }
          />
          <StepButton
            colorPalette="teal"
            value="scan"
            title={TASK_TYPES.scan}
            description="Run malicious datasets and adversarial attacks against your LLM application for Red Teaming"
            // Disabled for now
            // onClick={() => handleTaskSelection("scan")}
            disabled
            icon={
              <ColorfulBlockIcon
                color="teal.400"
                size="md"
                icon={<LuShield />}
                marginTop="-2px"
              />
            }
          />
        </VStack>
      </RadioCard.Root>
    </>
  );
}

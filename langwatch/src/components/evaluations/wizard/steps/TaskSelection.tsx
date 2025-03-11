import { Heading, Text, VStack } from "@chakra-ui/react";
import { Activity, Edit3 } from "react-feather";
import { LuBadgeCheck, LuListChecks, LuShield } from "react-icons/lu";
import { ColorfulBlockIcon } from "../../../../optimization_studio/components/ColorfulBlockIcons";
import { StepButton } from "../../StepButton";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";

export function TaskSelection() {
  const { setWizardState } = useEvaluationWizardStore();

  return (
    <>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          What are you trying to do?
        </Heading>
        <Text>Select what evaluation flow you want to follow</Text>
      </VStack>
      <VStack width="full" gap={3}>
        <StepButton
          title="Set up real-time evaluation"
          description="Evaluate messages as they arrive in production"
          onClick={() => setWizardState({ step: "dataset", task: "real-time" })}
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
          title="Evaluate your LLM pipeline"
          description="Run a batch evaluation of dataset examples against your existing LLM application"
          icon={
            <ColorfulBlockIcon
              color="blue.400"
              size="md"
              icon={<LuListChecks />}
              marginTop="-2px"
            />
          }
          disabled
        />
        <StepButton
          title="Prompt Creation"
          description="Build a new prompt and evaluate the quality of the outputs, iteratively improving it"
          icon={
            <ColorfulBlockIcon
              color="purple.400"
              size="md"
              icon={<Edit3 />}
              marginTop="-2px"
            />
          }
          disabled
        />
        <StepButton
          title="Create Custom Evaluator"
          description="Build your own reliable evaluator to be used by other flows, measuring and ensuring its accuracy"
          icon={
            <ColorfulBlockIcon
              color="orange.400"
              size="md"
              icon={<LuBadgeCheck />}
              marginTop="-2px"
            />
          }
          disabled
        />
        <StepButton
          title="Scan for Vulnerabilities (Coming Soon)"
          description="Run malicious datasets and adversarial attacks against your LLM application for Red Teaming"
          icon={
            <ColorfulBlockIcon
              color="teal.400"
              size="md"
              icon={<LuShield />}
              marginTop="-2px"
            />
          }
          disabled
        />
      </VStack>
    </>
  );
}

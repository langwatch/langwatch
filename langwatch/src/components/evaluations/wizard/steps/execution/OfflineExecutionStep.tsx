import { Accordion, VStack } from "@chakra-ui/react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { RadioCard } from "@chakra-ui/react";
import {
  LuCode,
  LuTerminal,
  LuGlobe,
  LuWorkflow,
  LuMessageSquareCode,
} from "react-icons/lu";
import { StepAccordion } from "../../components/StepAccordion";
import { StepRadio } from "../../components/StepButton";
import {
  EXECUTION_METHODS,
  type OfflineExecutionMethod,
  useEvaluationWizardStore,
} from "../../hooks/useEvaluationWizardStore";
import { useAnimatedFocusElementById } from "../../../../../hooks/useAnimatedFocusElementById";

export function OfflineExecutionStep() {
  const { executionMethod, setWizardState } = useEvaluationWizardStore(
    useShallow(({ wizardState, setWizardState }) => ({
      // Q: Why is this needed?
      executionMethod: wizardState.executionMethod,
      setWizardState,
    }))
  );

  const focusElementById = useAnimatedFocusElementById();

  const handleOptionClick = useCallback(
    (value: OfflineExecutionMethod) => {
      setWizardState({
        executionMethod: value,
      });
      focusElementById("js-next-step-button");
    },
    [setWizardState, focusElementById]
  );

  const buildBaseRadioParams = useCallback(
    (value: OfflineExecutionMethod) => {
      return {
        value,
        title: EXECUTION_METHODS[value],
        onClick: () => handleOptionClick(value),
      };
    },
    [handleOptionClick]
  );

  return (
    <Accordion.Root
      value={["execution-method"]}
      multiple={false}
      collapsible={false}
      width="full"
      variant="plain"
    >
      <VStack width="full" gap={3}>
        <StepAccordion
          value="execution-method"
          width="full"
          borderColor="orange.400"
          title="Execution Method"
          showTrigger={false}
        >
          <RadioCard.Root
            variant="outline"
            colorPalette="orange"
            value={executionMethod}
            paddingBottom={1}
          >
            <StepRadio
              {...buildBaseRadioParams("offline_prompt")}
              description="Run a prompt via any LLM model to evaluate"
              icon={<LuMessageSquareCode />}
            />
            <StepRadio
              {...buildBaseRadioParams("offline_code_execution")}
              description="Run code"
              icon={<LuCode />}
              disabled
            />
            <StepRadio
              {...buildBaseRadioParams("offline_http")}
              description="Execute your LLM pipeline if it's available on an HTTP endpoint"
              icon={<LuGlobe />}
              disabled
            />
            <StepRadio
              {...buildBaseRadioParams("offline_workflow")}
              description="Create a Workflow for building a more complex pipeline to be evaluated"
              icon={<LuWorkflow />}
              disabled
            />
            <StepRadio
              {...buildBaseRadioParams("offline_notebook")}
              description="Use LangWatch Python SDK to run"
              icon={<LuTerminal />}
              disabled
            />
          </RadioCard.Root>
        </StepAccordion>
      </VStack>
    </Accordion.Root>
  );
}

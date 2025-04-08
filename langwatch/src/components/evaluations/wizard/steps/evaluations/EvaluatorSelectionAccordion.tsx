import { Grid, RadioCard } from "@chakra-ui/react";
import { useEvaluationWizardStore } from "~/components/evaluations/wizard/hooks/useEvaluationWizardStore";
import { useAnimatedFocusElementById } from "../../../../../hooks/useAnimatedFocusElementById";
import { StepAccordion } from "../../components/StepAccordion";
import { StepRadio } from "../../components/StepButton";
import { evaluatorCategories } from "./CategorySelectionAccordion";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";

export const EvaluatorSelectionAccordion = ({
  setAccordeonValue,
}: {
  setAccordeonValue: (value: string[]) => void;
}) => {
  const { wizardState, getFirstEvaluatorNode, setFirstEvaluator } =
    useEvaluationWizardStore();

  const focusElementById = useAnimatedFocusElementById();

  const handleEvaluatorSelect = (evaluatorType: EvaluatorTypes) => {
    // This initializes the evaluator node without any properties
    setFirstEvaluator({
      evaluator: evaluatorType,
    });
    const nextStep =
      wizardState.task == "real_time" &&
      wizardState.dataSource == "from_production"
        ? ["settings"]
        : ["mappings"];
    setTimeout(() => {
      setAccordeonValue(nextStep);
      if (nextStep.includes("settings")) {
        focusElementById("js-next-step-button");
      } else {
        focusElementById("js-expand-settings-button");
      }
    }, 300);
  };

  return (
    <StepAccordion
      value="selection"
      width="full"
      borderColor="green.400"
      title="Evaluator Selection"
      showTrigger={!!wizardState.evaluatorCategory}
    >
      <RadioCard.Root
        variant="outline"
        colorPalette="green"
        value={getFirstEvaluatorNode()?.data.evaluator}
        onValueChange={(e: { value: EvaluatorTypes }) => {
          handleEvaluatorSelect(e.value);
        }}
        paddingTop={2}
        paddingBottom={5}
        paddingX="1px"
      >
        <Grid width="full" gap={3}>
          {evaluatorCategories
            .find((c) => c.id === wizardState.evaluatorCategory)
            ?.evaluators.map((evaluator) => (
              <StepRadio
                key={evaluator.id}
                value={evaluator.id}
                title={
                  evaluator.name + (evaluator.future ? " (Coming Soon)" : "")
                }
                description={evaluator.description}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!evaluator.future && !evaluator.disabled) {
                    handleEvaluatorSelect(evaluator.id);
                  }
                }}
                opacity={evaluator.future ?? evaluator.disabled ? 0.5 : 1}
                cursor={
                  evaluator.future ?? evaluator.disabled
                    ? "not-allowed"
                    : "pointer"
                }
              />
            ))}
        </Grid>
      </RadioCard.Root>
    </StepAccordion>
  );
};

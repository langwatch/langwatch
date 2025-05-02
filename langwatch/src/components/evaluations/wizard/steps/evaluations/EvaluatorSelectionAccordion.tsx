import { EmptyState, Grid, RadioCard } from "@chakra-ui/react";
import { useEvaluationWizardStore } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useAnimatedFocusElementById } from "../../../../../hooks/useAnimatedFocusElementById";
import { StepAccordion } from "../../components/StepAccordion";
import { StepRadio } from "../../components/StepButton";
import { useEvaluatorCategories } from "./CategorySelectionAccordion";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import { useAvailableEvaluators } from "../../../../../hooks/useAvailableEvaluators";
import { PuzzleIcon } from "../../../../icons/PuzzleIcon";
import { Link } from "../../../../ui/link";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";

export const EvaluatorSelectionAccordion = ({
  setAccordeonValue,
}: {
  setAccordeonValue: (value: string[]) => void;
}) => {
  const { project } = useOrganizationTeamProject();
  const { wizardState, getFirstEvaluatorNode, setFirstEvaluator } =
    useEvaluationWizardStore();

  const focusElementById = useAnimatedFocusElementById();

  const availableEvaluators = useAvailableEvaluators();

  const handleEvaluatorSelect = (
    evaluatorType: EvaluatorTypes | `custom/${string}`
  ) => {
    // This initializes the evaluator node without any properties
    setFirstEvaluator(
      {
        evaluator: evaluatorType,
      },
      availableEvaluators
    );
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

  const evaluatorCategories = useEvaluatorCategories();
  const evaluators =
    evaluatorCategories.find((c) => c.id === wizardState.evaluatorCategory)
      ?.evaluators ?? [];

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
        onValueChange={(e: { value: EvaluatorTypes | `custom/${string}` }) => {
          handleEvaluatorSelect(e.value);
        }}
        paddingTop={2}
        paddingBottom={5}
        paddingX="1px"
      >
        <Grid width="full" gap={3}>
          {evaluators.map((evaluator) => (
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
          {wizardState.evaluatorCategory === "custom_evaluators" &&
            evaluators.length === 0 && (
              <EmptyState.Root>
                <EmptyState.Content>
                  <EmptyState.Indicator>
                    <PuzzleIcon />
                  </EmptyState.Indicator>
                  <EmptyState.Title>
                    No custom evaluators published yet
                  </EmptyState.Title>
                  <EmptyState.Description>
                    <Link
                      href={`/${project?.slug}/workflows`}
                      textDecoration="underline"
                    >
                      Go to Workflows
                    </Link>{" "}
                    to create your first custom evaluator.
                  </EmptyState.Description>
                </EmptyState.Content>
              </EmptyState.Root>
            )}
        </Grid>
      </RadioCard.Root>
    </StepAccordion>
  );
};

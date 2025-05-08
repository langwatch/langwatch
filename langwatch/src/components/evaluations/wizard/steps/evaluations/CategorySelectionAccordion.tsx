import { Grid, RadioCard } from "@chakra-ui/react";
import {
  LuBrain,
  LuCode,
  LuDatabase,
  LuShield,
  LuSquareCheckBig,
  LuStar,
} from "react-icons/lu";
import {
  type EVALUATOR_CATEGORIES,
  useEvaluationWizardStore,
  type EvaluatorCategory as EvaluationCategory,
} from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { AVAILABLE_EVALUATORS } from "../../../../../server/evaluations/evaluators.generated";
import { Tooltip } from "../../../../ui/tooltip";
import { StepAccordion } from "../../components/StepAccordion";
import { StepRadio } from "../../components/StepButton";
import { api } from "../../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useMemo } from "react";
import { PuzzleIcon } from "../../../../icons/PuzzleIcon";

type EvaluationCategoryConfig = {
  id: (typeof EVALUATOR_CATEGORIES)[number];
  name: string;
  description: string;
  icon: React.ReactNode;
  evaluators: EvaluationType[];
  realtime: boolean;
};

type EvaluationType = {
  id: keyof typeof AVAILABLE_EVALUATORS | `custom/${string}`;
  name: string;
  description: string;
  disabled?: boolean;
  future?: boolean;
};

export const useEvaluatorCategories = (): EvaluationCategoryConfig[] => {
  const { project } = useOrganizationTeamProject();

  const availableCustomEvaluators =
    api.evaluations.availableCustomEvaluators.useQuery(
      { projectId: project?.id ?? "" },
      { enabled: !!project }
    );

  return useMemo(
    () =>
      [
        {
          id: "expected_answer",
          name: "Expected Answer Evaluation",
          description:
            "For when you have the golden answer and want to measure how correct can the LLM get it",
          icon: <LuSquareCheckBig />,
          evaluators: (
            [
              "langevals/exact_match",
              "langevals/llm_answer_match",
              "ragas/factual_correctness",
              "ragas/sql_query_equivalence",
              "ragas/rouge_score",
              "ragas/bleu_score",
            ] as const
          ).map((evaluator) => ({
            id: evaluator,
            name: AVAILABLE_EVALUATORS[evaluator].name,
            description: AVAILABLE_EVALUATORS[evaluator].description,
          })),
          realtime: false,
        },
        {
          id: "llm_judge",
          name: "LLM-as-a-Judge",
          description:
            "For when you don't have a golden answer, but have a set of rules for another LLM to evaluate quality",
          icon: <LuBrain />,
          evaluators: (
            [
              "langevals/llm_boolean",
              "langevals/llm_score",
              "langevals/llm_category",
              "ragas/rubrics_based_scoring",
            ] as const
          ).map((evaluator) => ({
            id: evaluator,
            name: AVAILABLE_EVALUATORS[evaluator].name,
            description: AVAILABLE_EVALUATORS[evaluator].description,
          })),
          realtime: true,
        },
        {
          id: "rag",
          name: "RAG Quality",
          description:
            "For measuring the quality of your RAG, check for hallucinations with faithfulness and precision/recall",
          icon: <LuDatabase />,
          evaluators: (
            [
              "ragas/faithfulness",
              "ragas/response_relevancy",
              "ragas/response_context_recall",
              "ragas/response_context_precision",
              "ragas/context_f1",
              "ragas/context_precision",
              "ragas/context_recall",
            ] as const
          ).map((evaluator) => ({
            id: evaluator,
            name: AVAILABLE_EVALUATORS[evaluator].name,
            description: AVAILABLE_EVALUATORS[evaluator].description,
          })),
          realtime: true,
        },
        {
          id: "quality",
          name: "Quality Aspects Evaluation",
          description:
            "For when you want to check the language, structure, style and other general quality metrics",
          icon: <LuStar />,
          evaluators: (
            [
              "lingua/language_detection",
              "ragas/summarization_score",
              "langevals/valid_format",
            ] as const
          ).map((evaluator) => ({
            id: evaluator,
            name: AVAILABLE_EVALUATORS[evaluator].name,
            description: AVAILABLE_EVALUATORS[evaluator].description,
          })),
          realtime: true,
        },
        {
          id: "safety",
          name: "Safety",
          description:
            "Check for PII, prompt injection attempts and toxic content",
          icon: <LuShield />,
          evaluators: [
            {
              id: "presidio/pii_detection",
              name: "PII Detection",
              description:
                AVAILABLE_EVALUATORS["presidio/pii_detection"].description,
            },
            {
              id: "azure/prompt_injection",
              name: "Prompt Injection / Jailbreak Detection",
              description:
                "Detect prompt injection attempts and jailbreak attempts in the input",
            },
            {
              id: "azure/content_safety",
              name: "Content Safety",
              description:
                AVAILABLE_EVALUATORS["azure/content_safety"].description,
            },
          ],
          realtime: true,
        },
        {
          id: "custom_evaluators",
          name: "Custom Evaluators",
          description: "Evaluate with your own custom evaluators",
          icon: <PuzzleIcon />,
          evaluators: (availableCustomEvaluators.data ?? []).map(
            (evaluator) => ({
              id: `custom/${evaluator.id}`,
              name: evaluator.name,
              description: evaluator.description,
            })
          ),
          realtime: true,
        },
      ] satisfies EvaluationCategoryConfig[],
    [availableCustomEvaluators.data]
  );
};

export const CategorySelectionAccordion = ({
  setAccordeonValue,
}: {
  setAccordeonValue: (value: string[]) => void;
}) => {
  const { setWizardState, wizardState } = useEvaluationWizardStore();

  const handleCategorySelect = (categoryId: EvaluationCategory) => {
    setWizardState({
      evaluatorCategory: categoryId,
    });
    setTimeout(() => {
      setAccordeonValue(["selection"]);
    }, 300);
  };

  const evaluatorCategories = useEvaluatorCategories();

  return (
    <StepAccordion
      value="category"
      width="full"
      borderColor="green.400"
      title="Evaluation Category"
      showTrigger={!!wizardState.evaluatorCategory}
    >
      <RadioCard.Root
        variant="outline"
        colorPalette="green"
        value={wizardState.evaluatorCategory}
        onValueChange={(e: { value: string }) =>
          handleCategorySelect(e.value as EvaluationCategory)
        }
        paddingTop={2}
        paddingBottom={5}
        paddingX="1px"
      >
        <Grid width="full" gap={3}>
          {evaluatorCategories
            .sort((a, b) => {
              if (wizardState.task === "real_time") {
                if (a.realtime && !b.realtime) return -1;
                if (!a.realtime && b.realtime) return 1;
              }
              return 0;
            })
            .map((category) => {
              const isDisabled =
                !category.realtime && wizardState.task === "real_time";
              return (
                <Tooltip
                  key={category.id}
                  content={`${category.name} is not available for real-time evaluations`}
                  disabled={!isDisabled}
                  showArrow
                  positioning={{ placement: "right" }}
                >
                  <StepRadio
                    title={category.name}
                    description={category.description}
                    icon={category.icon}
                    value={category.id}
                    disabled={isDisabled}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isDisabled) {
                        handleCategorySelect(category.id);
                      }
                    }}
                  />
                </Tooltip>
              );
            })}
        </Grid>
      </RadioCard.Root>
    </StepAccordion>
  );
};

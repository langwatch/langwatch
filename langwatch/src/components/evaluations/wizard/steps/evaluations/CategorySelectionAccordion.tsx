import {
  Accordion,
  Grid,
  HStack,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Brain,
  CheckSquare,
  ChevronDown,
  Database,
  Shield,
  Star,
} from "lucide-react";
import {
  useEvaluationWizardStore,
  type EvaluatorCategory as EvaluationCategory,
} from "~/components/evaluations/wizard/hooks/useEvaluationWizardStore";
import { OverflownTextWithTooltip } from "../../../../OverflownText";
import { Tooltip } from "../../../../ui/tooltip";
import type { AVAILABLE_EVALUATORS } from "../../../../../server/evaluations/evaluators.generated";
import { StepAccordion } from "../../components/StepAccordion";
import { StepRadio } from "../../components/StepButton";
import {
  LuBrain,
  LuDatabase,
  LuShield,
  LuSquareCheckBig,
  LuStar,
} from "react-icons/lu";

type EvaluationCategoryConfig = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  evaluators: EvaluationType[];
  realtime: boolean;
};

type EvaluationType = {
  id: keyof typeof AVAILABLE_EVALUATORS;
  name: string;
  description: string;
  disabled?: boolean;
  future?: boolean;
};

export const evaluatorCategories: EvaluationCategoryConfig[] = [
  {
    id: "expected_answer",
    name: "Expected Answer Evaluation",
    description:
      "For when you have the golden answer and want to measure how correct can the LLM get it",
    icon: <LuSquareCheckBig />,
    evaluators: [
      // {
      //   id: "langevals/exact_match",
      //   name: "Exact Match",
      //   description:
      //     "Compare the output with the expected answer for exact matches",
      // },
      {
        id: "langevals/llm_answer_match",
        name: "LLM Answer Match",
        description:
          "Use an LLM to check if the generated output answers a question correctly the same way as the expected output",
      },
      {
        id: "ragas/factual_correctness",
        name: "LLM Factual Correctness",
        description:
          "Computes with an LLM how factually similar the generated answer is to the expected output",
      },
      // {
      //   id: "extracted_data_match",
      //   name: "Extracted Data Match",
      //   description:
      //     "Compare structured data extracted from the output with expected data",
      //   future: true,
      // },
      // {
      //   id: "tool_usage",
      //   name: "Tool Usage Evaluation",
      //   description:
      //     "Evaluate if the LLM is using tools correctly and effectively",
      //   future: true,
      // },
    ],
    realtime: false,
  },
  {
    id: "llm_judge",
    name: "LLM-as-a-Judge",
    description:
      "For when you don't have a golden answer, but have a set of rules for another LLM to evaluate quality",
    icon: <LuBrain />,
    evaluators: [
      // {
      //   id: "llm_boolean",
      //   name: "LLM-as-a-Judge Boolean",
      //   description:
      //     "Use an LLM to perform true/false boolean evaluation of the message",
      // },
      // {
      //   id: "llm_score",
      //   name: "LLM-as-a-Judge Score",
      //   description:
      //     "Use an LLM to generate a numeric score evaluation of the message",
      // },
      // {
      //   id: "llm_category",
      //   name: "LLM-as-a-Judge Category",
      //   description:
      //     "Use an LLM to classify the message into custom defined categories",
      // },
      // {
      //   id: "rubrics_scoring",
      //   name: "Rubrics Based Scoring",
      //   description:
      //     "Evaluate responses using a rubric with descriptions for each score level",
      // },
    ],
    realtime: true,
  },
  {
    id: "quality",
    name: "Quality Aspects Evaluation",
    description:
      "For when you want to check the language, structure, style and other general quality metrics",
    icon: <LuStar />,
    evaluators: [
      // {
      //   id: "language_detection",
      //   name: "Language Detection",
      //   description: "Detect and verify the language of inputs and outputs",
      // },
      // {
      //   id: "summarization_score",
      //   name: "Summarization Score",
      //   description:
      //     "Measure how well the summary captures important information",
      // },
      // {
      //   id: "response_relevancy",
      //   name: "Response Relevancy",
      //   description:
      //     "Evaluate how pertinent the generated answer is to the given prompt",
      // },
      // {
      //   id: "valid_format",
      //   name: "Valid Format",
      //   description:
      //     "Check if the output follows a valid format (JSON, Markdown, etc)",
      // },
    ],
    realtime: true,
  },
  {
    id: "rag",
    name: "RAG Quality",
    description:
      "For measuring the quality of your RAG, check for hallucinations with faithfulness and precision/recall",
    icon: <LuDatabase />,
    evaluators: [
      // {
      //   id: "faithfulness",
      //   name: "Ragas Faithfulness",
      //   description:
      //     "Assess if the generated answer is consistent with the provided context",
      // },
      // {
      //   id: "context_f1",
      //   name: "Context F1",
      //   description:
      //     "Balance between precision and recall for context retrieval",
      // },
      // {
      //   id: "context_precision",
      //   name: "Context Precision",
      //   description:
      //     "Measure how accurate the retrieval is compared to expected contexts",
      // },
      // {
      //   id: "context_recall",
      //   name: "Context Recall",
      //   description: "Measure how many relevant contexts were retrieved",
      // },
    ],
    realtime: true,
  },
  {
    id: "safety",
    name: "Safety",
    description: "Check for PII, prompt injection attempts and toxic content",
    icon: <LuShield />,
    evaluators: [
      {
        id: "presidio/pii_detection",
        name: "PII Detection",
        description: "Detect personally identifiable information in text",
      },
      // {
      //   id: "prompt_injection",
      //   name: "Prompt Injection Detection",
      //   description: "Check for prompt injection attempts in the input",
      // },
      // {
      //   id: "content_safety",
      //   name: "Content Safety",
      //   description:
      //     "Detect potentially unsafe content including hate speech and violence",
      // },
      // {
      //   id: "moderation",
      //   name: "Moderation",
      //   description: "Check for harmful content using OpenAI's moderation API",
      // },
    ],
    realtime: true,
  },
];

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
                        handleCategorySelect(category.id as EvaluationCategory);
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

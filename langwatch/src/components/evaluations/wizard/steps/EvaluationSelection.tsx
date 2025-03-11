import {
  Accordion,
  Grid,
  Heading,
  HStack,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import {
  ChevronDown,
  CheckSquare,
  Award,
  Star,
  Database,
  Shield,
  Brain,
} from "lucide-react";
import { useEvaluationWizardStore, type EvaluatorCategory } from "~/hooks/useEvaluationWizardStore";
import { OverflownTextWithTooltip } from "../../../OverflownText";
import type { Evaluators } from "~/server/evaluations/evaluators.generated";

type EvaluatorType = {
  id: string;
  name: string;
  description: string;
  disabled?: boolean;
  future?: boolean;
};

type EvaluatorCategoryConfig = {
  id: EvaluatorCategory;
  name: string;
  description: string;
  icon: React.ReactNode;
  evaluators: EvaluatorType[];
};

const evaluatorCategories: EvaluatorCategoryConfig[] = [
  {
    id: "expected_answer",
    name: "Expected Answer Evaluation",
    description: "For when you have the golden answer and want to measure how correct can the LLM get it",
    icon: <CheckSquare />,
    evaluators: [
      {
        id: "exact_match",
        name: "Exact Match",
        description: "Compare the output with the expected answer for exact matches",
      },
      {
        id: "llm_answer_match",
        name: "LLM Answer Match",
        description: "Use an LLM to check if the generated output answers a question correctly the same way as the expected output",
      },
      {
        id: "llm_factual_correctness",
        name: "LLM Factual Correctness",
        description: "Computes with an LLM how factually similar the generated answer is to the expected output",
      },
      {
        id: "extracted_data_match",
        name: "Extracted Data Match",
        description: "Compare structured data extracted from the output with expected data",
        future: true,
      },
      {
        id: "tool_usage",
        name: "Tool Usage Evaluation",
        description: "Evaluate if the LLM is using tools correctly and effectively",
        future: true,
      },
    ],
  },
  {
    id: "llm_judge",
    name: "LLM-as-a-Judge",
    description: "For when you don't have a golden answer, but have a set of rules for another LLM to evaluate quality",
    icon: <Brain />,
    evaluators: [
      {
        id: "llm_boolean",
        name: "LLM-as-a-Judge Boolean",
        description: "Use an LLM to perform true/false boolean evaluation of the message",
      },
      {
        id: "llm_score",
        name: "LLM-as-a-Judge Score",
        description: "Use an LLM to generate a numeric score evaluation of the message",
      },
      {
        id: "llm_category",
        name: "LLM-as-a-Judge Category",
        description: "Use an LLM to classify the message into custom defined categories",
      },
      {
        id: "rubrics_scoring",
        name: "Rubrics Based Scoring",
        description: "Evaluate responses using a rubric with descriptions for each score level",
      },
    ],
  },
  {
    id: "quality",
    name: "Quality Aspects Evaluation",
    description: "For when you want to check the language, structure, style and other general quality metrics",
    icon: <Star />,
    evaluators: [
      {
        id: "language_detection",
        name: "Language Detection",
        description: "Detect and verify the language of inputs and outputs",
      },
      {
        id: "summarization_score",
        name: "Summarization Score",
        description: "Measure how well the summary captures important information",
      },
      {
        id: "response_relevancy",
        name: "Response Relevancy",
        description: "Evaluate how pertinent the generated answer is to the given prompt",
      },
      {
        id: "valid_format",
        name: "Valid Format",
        description: "Check if the output follows a valid format (JSON, Markdown, etc)",
      },
    ],
  },
  {
    id: "rag",
    name: "RAG Quality",
    description: "For measuring the quality of your RAG, check for hallucinations with faithfulness and precision/recall",
    icon: <Database />,
    evaluators: [
      {
        id: "faithfulness",
        name: "Ragas Faithfulness",
        description: "Assess if the generated answer is consistent with the provided context",
      },
      {
        id: "context_f1",
        name: "Context F1",
        description: "Balance between precision and recall for context retrieval",
      },
      {
        id: "context_precision",
        name: "Context Precision",
        description: "Measure how accurate the retrieval is compared to expected contexts",
      },
      {
        id: "context_recall",
        name: "Context Recall",
        description: "Measure how many relevant contexts were retrieved",
      },
    ],
  },
  {
    id: "safety",
    name: "Safety",
    description: "Check for PII, prompt injection attempts and toxic content",
    icon: <Shield />,
    evaluators: [
      {
        id: "pii_detection",
        name: "PII Detection",
        description: "Detect personally identifiable information in text",
      },
      {
        id: "prompt_injection",
        name: "Prompt Injection Detection",
        description: "Check for prompt injection attempts in the input",
      },
      {
        id: "content_safety",
        name: "Content Safety",
        description: "Detect potentially unsafe content including hate speech and violence",
      },
      {
        id: "moderation",
        name: "Moderation",
        description: "Check for harmful content using OpenAI's moderation API",
      },
    ],
  },
];

export function EvaluationSelection() {
  const { setWizardState, wizardState } = useEvaluationWizardStore();
  const [accordeonValue, setAccordeonValue] = useState<string[]>(
    wizardState.evaluatorCategory ? ["configuration"] : ["category"]
  );

  const handleCategorySelect = (categoryId: EvaluatorCategory) => {
    setWizardState({
      evaluatorCategory: categoryId,
    });
    setAccordeonValue(["configuration"]);
  };

  const handleEvaluatorSelect = (evaluator: EvaluatorType) => {
    if (evaluator.future || evaluator.disabled) return;
    
    setWizardState({
      evaluator: {
        langevals: evaluator.id as keyof Evaluators
      },
      step: "evaluator",
    });
  };

  return (
    <VStack width="full" align="start" gap={4}>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          Evaluation Type
        </Heading>
        <Text>Choose what aspect of your LLM you want to evaluate</Text>
      </VStack>

      <Accordion.Root
        value={accordeonValue}
        onValueChange={(e) => setAccordeonValue(e.value)}
        multiple={false}
        collapsible
        width="full"
        variant="plain"
      >
        {/* First Accordion - Category Selection */}
        <VStack width="full" gap={3}>
          <Accordion.Item value="category" width="full" paddingY={2}>
            {wizardState.evaluatorCategory && (
              <Accordion.ItemTrigger width="full" paddingX={2} paddingY={3}>
                <HStack width="full" alignItems="center">
                  <VStack width="full" align="start" gap={1}>
                    Evaluation Category
                  </VStack>
                </HStack>
                <Accordion.ItemIndicator>
                  <ChevronDown />
                </Accordion.ItemIndicator>
              </Accordion.ItemTrigger>
            )}
            <Accordion.ItemContent paddingTop={2}>
              <RadioCard.Root
                variant="outline"
                colorPalette="blue"
                value={wizardState.evaluatorCategory}
              >
                <Grid width="full" gap={3}>
                  {evaluatorCategories.map((category) => (
                    <RadioCard.Item
                      key={category.id}
                      value={category.id}
                      width="full"
                      minWidth={0}
                      onClick={() => handleCategorySelect(category.id)}
                    >
                      <RadioCard.ItemHiddenInput />
                      <RadioCard.ItemControl cursor="pointer" width="full">
                        <RadioCard.ItemContent width="full">
                          <VStack
                            align="start"
                            gap={3}
                            _icon={{ color: "blue.300" }}
                            width="full"
                          >
                            {category.icon}
                            <VStack align="start" gap={1} width="full">
                              <OverflownTextWithTooltip>
                                {category.name}
                              </OverflownTextWithTooltip>
                              <Text
                                fontSize="sm"
                                color="gray.500"
                                fontWeight="normal"
                              >
                                {category.description}
                              </Text>
                            </VStack>
                          </VStack>
                        </RadioCard.ItemContent>
                        <RadioCard.ItemIndicator />
                      </RadioCard.ItemControl>
                    </RadioCard.Item>
                  ))}
                </Grid>
              </RadioCard.Root>
            </Accordion.ItemContent>
          </Accordion.Item>
        </VStack>

        {/* Second Accordion - Evaluator Selection */}
        {wizardState.evaluatorCategory && (
          <VStack width="full" gap={3}>
            <Accordion.Item value="configuration" width="full">
              <Accordion.ItemTrigger width="full">
                <HStack width="full" alignItems="center" paddingX={2} paddingY={3}>
                  <VStack width="full" align="start" gap={1}>
                    <Text>Select Evaluator</Text>
                  </VStack>
                  <Accordion.ItemIndicator>
                    <ChevronDown />
                  </Accordion.ItemIndicator>
                </HStack>
              </Accordion.ItemTrigger>
              <Accordion.ItemContent paddingTop={2} paddingX="1px">
                <RadioCard.Root
                  variant="outline"
                  colorPalette="blue"
                  value={wizardState.evaluator && 'langevals' in wizardState.evaluator ? wizardState.evaluator.langevals : undefined}
                >
                  <Grid width="full" templateColumns="repeat(2, 1fr)" gap={3}>
                    {evaluatorCategories
                      .find((c) => c.id === wizardState.evaluatorCategory)
                      ?.evaluators.map((evaluator) => (
                        <RadioCard.Item
                          key={evaluator.id}
                          value={evaluator.id}
                          width="full"
                          minWidth={0}
                          onClick={() =>
                            !evaluator.future &&
                            !evaluator.disabled &&
                            handleEvaluatorSelect(evaluator)
                          }
                          opacity={
                            evaluator.future || evaluator.disabled ? 0.5 : 1
                          }
                          cursor={
                            evaluator.future || evaluator.disabled
                              ? "not-allowed"
                              : "pointer"
                          }
                        >
                          <RadioCard.ItemHiddenInput />
                          <RadioCard.ItemControl
                            cursor={
                              evaluator.future || evaluator.disabled
                                ? "not-allowed"
                                : "pointer"
                            }
                            width="full"
                          >
                            <RadioCard.ItemContent width="full">
                              <VStack align="start" gap={1} width="full">
                                <HStack>
                                  <Text>{evaluator.name}</Text>
                                  {evaluator.future && (
                                    <Text
                                      as="span"
                                      fontSize="xs"
                                      color="gray.500"
                                    >
                                      (Coming Soon)
                                    </Text>
                                  )}
                                </HStack>
                                <Text
                                  fontSize="sm"
                                  color="gray.500"
                                  fontWeight="normal"
                                >
                                  {evaluator.description}
                                </Text>
                              </VStack>
                            </RadioCard.ItemContent>
                            <RadioCard.ItemIndicator />
                          </RadioCard.ItemControl>
                        </RadioCard.Item>
                      ))}
                  </Grid>
                </RadioCard.Root>
              </Accordion.ItemContent>
            </Accordion.Item>
          </VStack>
        )}
      </Accordion.Root>
    </VStack>
  );
} 

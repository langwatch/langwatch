import {
  Accordion,
  Field,
  Grid,
  Heading,
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
import { useCallback, useEffect, useState } from "react";
import {
  useEvaluationWizardStore,
  type EvaluatorCategory as EvaluationCategory,
  type State,
} from "~/hooks/useEvaluationWizardStore";
import {
  AVAILABLE_EVALUATORS,
  type Evaluators,
} from "~/server/evaluations/evaluators.generated";
import { OverflownTextWithTooltip } from "../../../OverflownText";
import { Tooltip } from "../../../ui/tooltip";
import { convertEvaluator } from "../../../../optimization_studio/utils/registryUtils";
import { z } from "zod";
import { evaluatorsSchema } from "../../../../server/evaluations/evaluators.zod.generated";
import DynamicZodForm from "../../../checks/DynamicZodForm";
import { FormProvider, useForm } from "react-hook-form";
import { getEvaluatorDefaultSettings } from "../../../../server/evaluations/getEvaluator";
import type { Field } from "../../../../optimization_studio/types/dsl";
import {
  DEFAULT_MAPPINGS,
  MAPPING_OPTIONS,
  MappingsFields,
} from "../../../checks/CheckConfigForm";

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

const evaluatorCategories: EvaluationCategoryConfig[] = [
  {
    id: "expected_answer",
    name: "Expected Answer Evaluation",
    description:
      "For when you have the golden answer and want to measure how correct can the LLM get it",
    icon: <CheckSquare />,
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
    icon: <Brain />,
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
    icon: <Star />,
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
    icon: <Database />,
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
    icon: <Shield />,
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

export function EvaluationSelection() {
  const { wizardState, getFirstEvaluator } = useEvaluationWizardStore();
  const [accordeonValue, setAccordeonValue] = useState<string[]>(
    wizardState.evaluatorCategory
      ? getFirstEvaluator()
        ? ["selection"]
        : ["settings"]
      : ["category"]
  );

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
        onValueChange={(e: { value: string[] }) => setAccordeonValue(e.value)}
        multiple={false}
        collapsible
        width="full"
        variant="plain"
      >
        <VStack width="full">
          <CategorySelectionAccordion setAccordeonValue={setAccordeonValue} />
          <EvaluatorSelectionAccordion setAccordeonValue={setAccordeonValue} />
          <EvaluatorMappingAccordion />
          <EvaluatorSettingsAccordion />
        </VStack>
      </Accordion.Root>
    </VStack>
  );
}

const CategorySelectionAccordion = ({
  setAccordeonValue,
}: {
  setAccordeonValue: (value: string[]) => void;
}) => {
  const { setWizardState, wizardState } = useEvaluationWizardStore();

  const handleCategorySelect = (categoryId: EvaluationCategory) => {
    setWizardState({
      evaluatorCategory: categoryId,
    });
    setAccordeonValue(["selection"]);
  };

  return (
    <Accordion.Item value="category" width="full">
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
      <Accordion.ItemContent>
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
                    <RadioCard.Item
                      value={category.id}
                      width="full"
                      minWidth={0}
                      disabled={isDisabled}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isDisabled) {
                          handleCategorySelect(
                            category.id as EvaluationCategory
                          );
                        }
                      }}
                    >
                      <RadioCard.ItemHiddenInput />
                      <RadioCard.ItemControl cursor="pointer" width="full">
                        <RadioCard.ItemContent width="full">
                          <HStack
                            align="start"
                            gap={3}
                            _icon={{ color: "green.300" }}
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
                          </HStack>
                        </RadioCard.ItemContent>
                        <RadioCard.ItemIndicator />
                      </RadioCard.ItemControl>
                    </RadioCard.Item>
                  </Tooltip>
                );
              })}
          </Grid>
        </RadioCard.Root>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};

const EvaluatorSelectionAccordion = ({
  setAccordeonValue,
}: {
  setAccordeonValue: (value: string[]) => void;
}) => {
  const { wizardState, getFirstEvaluator, setFirstEvaluator } =
    useEvaluationWizardStore();

  const handleEvaluatorSelect = (evaluatorType: string) => {
    setFirstEvaluator({
      evaluator: evaluatorType,
    });

    const nextStep =
      wizardState.task == "real_time" &&
      wizardState.dataSource == "from_production"
        ? ["settings"]
        : ["mappings"];
    setAccordeonValue(nextStep);
  };

  return (
    <Accordion.Item
      value="selection"
      width="full"
      hidden={!wizardState.evaluatorCategory}
    >
      <Accordion.ItemTrigger width="full">
        <HStack width="full" alignItems="center" paddingX={2} paddingY={3}>
          <VStack width="full" align="start" gap={1}>
            <Text>Evaluator Selection</Text>
          </VStack>
          <Accordion.ItemIndicator>
            <ChevronDown />
          </Accordion.ItemIndicator>
        </HStack>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <RadioCard.Root
          variant="outline"
          colorPalette="green"
          value={getFirstEvaluator()?.evaluator}
          onValueChange={(e: { value: string }) => {
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
                <RadioCard.Item
                  key={evaluator.id}
                  value={evaluator.id}
                  width="full"
                  minWidth={0}
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
                >
                  <RadioCard.ItemHiddenInput />
                  <RadioCard.ItemControl
                    cursor={
                      evaluator.future ?? evaluator.disabled
                        ? "not-allowed"
                        : "pointer"
                    }
                    width="full"
                  >
                    <RadioCard.ItemContent width="full">
                      <VStack align="start" gap={1} width="full">
                        <HStack>
                          <Text fontWeight="semibold">{evaluator.name}</Text>
                          {evaluator.future && (
                            <Text as="span" fontSize="xs" color="gray.500">
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
  );
};

const EvaluatorMappingAccordion = () => {
  const { wizardState, getFirstEvaluator, setFirstEvaluator } =
    useEvaluationWizardStore();

  const evaluator = getFirstEvaluator();
  const evaluatorType = evaluator?.evaluator;
  const evaluatorDefinition =
    evaluatorType && evaluatorType in AVAILABLE_EVALUATORS
      ? AVAILABLE_EVALUATORS[evaluatorType as keyof Evaluators]
      : undefined;

  const form = useForm<{
    customMapping: Record<string, string>;
  }>({
    defaultValues: {
      customMapping: {},
    },
  });

  return (
    <Accordion.Item
      value="mappings"
      width="full"
      hidden={!wizardState.evaluatorCategory}
    >
      <Accordion.ItemTrigger width="full">
        <HStack width="full" alignItems="center" paddingX={2} paddingY={3}>
          <VStack width="full" align="start" gap={1}>
            <Text>Data Mapping</Text>
          </VStack>
          <Accordion.ItemIndicator>
            <ChevronDown />
          </Accordion.ItemIndicator>
        </HStack>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <VStack
          align="start"
          padding={2}
          paddingBottom={5}
          width="full"
          gap={8}
        >
          {wizardState.task == "real_time" && evaluatorDefinition ? (
            <>
              <Text>
                What data from the real time traces will be used for evaluation?
              </Text>
              <Field.Root>
                <VStack align="start" gap={4} width="full">
                  <MappingsFields
                    titles={["Dataset", "Evaluator"]}
                    register={form.register}
                    mappingOptions={MAPPING_OPTIONS}
                    defaultValues={
                      wizardState.evaluatorMappings
                        ? {
                            ...DEFAULT_MAPPINGS,
                            ...(wizardState.evaluatorMappings ?? {}),
                          }
                        : DEFAULT_MAPPINGS
                    }
                    optionalFields={evaluatorDefinition.optionalFields}
                    requiredFields={evaluatorDefinition.requiredFields}
                  />
                </VStack>
              </Field.Root>
            </>
          ) : evaluatorDefinition ? (
            <>
              <Text>
                What columns from the dataset should be used for evaluation?
              </Text>
              <Field.Root>
                <VStack align="start" gap={4} width="full">
                  <MappingsFields
                    titles={["Dataset", "Evaluator"]}
                    register={form.register}
                    mappingOptions={MAPPING_OPTIONS}
                    defaultValues={
                      wizardState.evaluatorMappings
                        ? {
                            ...DEFAULT_MAPPINGS,
                            ...(wizardState.evaluatorMappings ?? {}),
                          }
                        : DEFAULT_MAPPINGS
                    }
                    optionalFields={evaluatorDefinition.optionalFields}
                    requiredFields={evaluatorDefinition.requiredFields}
                  />
                </VStack>
              </Field.Root>
            </>
          ) : null}
        </VStack>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};

const EvaluatorSettingsAccordion = () => {
  const { wizardState, getFirstEvaluator, setFirstEvaluator } =
    useEvaluationWizardStore();

  const evaluator = getFirstEvaluator();
  const evaluatorType = evaluator?.evaluator;

  const schema =
    evaluatorType && evaluatorType in AVAILABLE_EVALUATORS
      ? evaluatorsSchema.shape[evaluatorType as keyof Evaluators].shape.settings
      : undefined;

  const hasEvaluatorFields =
    evaluator &&
    evaluatorType &&
    schema instanceof z.ZodObject &&
    Object.keys(schema.shape).length > 0;

  const settingsFromParameters = Object.fromEntries(
    (evaluator?.parameters ?? []).map(({ identifier, value }) => [
      identifier,
      value,
    ])
  );

  const defaultSettings:
    | ReturnType<typeof getEvaluatorDefaultSettings>
    | undefined =
    Object.keys(settingsFromParameters).length > 0
      ? (settingsFromParameters as any)
      : evaluatorType
      ? getEvaluatorDefaultSettings(
          AVAILABLE_EVALUATORS[evaluatorType as keyof Evaluators]
        )
      : undefined;

  const form = useForm<{
    settings: typeof defaultSettings;
    customMapping: Record<string, string>;
  }>({
    defaultValues: {
      settings: defaultSettings,
      customMapping: {},
    },
  });

  useEffect(() => {
    if (!defaultSettings) return;

    form.reset({
      settings: defaultSettings,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluatorType]);

  const onSubmit = useCallback(
    (data: { settings?: Record<string, any> }) => {
      if (!evaluatorType) return;

      setFirstEvaluator({
        evaluator: evaluatorType,
        parameters: Object.entries(data.settings ?? {}).map(
          ([identifier, value]) =>
            ({
              identifier,
              type: "str",
              value: value,
            }) as Field
        ),
      });
    },
    [evaluatorType, setFirstEvaluator]
  );

  useEffect(() => {
    form.watch(() => {
      console.log(form.getValues());
      void form.handleSubmit(onSubmit)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  return (
    <Accordion.Item
      value="settings"
      width="full"
      hidden={!wizardState.evaluatorCategory || !hasEvaluatorFields}
    >
      <Accordion.ItemTrigger width="full">
        <HStack width="full" alignItems="center" paddingX={2} paddingY={3}>
          <VStack width="full" align="start" gap={1}>
            <Text>Evaluator Settings</Text>
          </VStack>
          <Accordion.ItemIndicator>
            <ChevronDown />
          </Accordion.ItemIndicator>
        </HStack>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent padding={2}>
        <FormProvider {...form}>
          <VStack width="full" gap={3}>
            {hasEvaluatorFields && (
              <DynamicZodForm
                schema={schema}
                evaluatorType={evaluatorType as keyof Evaluators}
                prefix="settings"
                errors={form.formState.errors.settings}
                variant="default"
              />
            )}
          </VStack>
        </FormProvider>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
};

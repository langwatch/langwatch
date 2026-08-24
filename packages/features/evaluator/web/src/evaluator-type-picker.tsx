import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import { LuExternalLink } from "react-icons/lu";
import type { EvaluatorCategoryId } from "./evaluator-category-picker";

type EvaluatorPickerCategory = EvaluatorCategoryId | "ignored";

/**
 * A deliberate product taxonomy. Exhaustiveness against the contract means a
 * newly-shipped evaluator cannot silently disappear from the picker.
 */
const evaluatorCategoryMap: Record<EvaluatorTypes, EvaluatorPickerCategory> = {
  "langevals/exact_match": "expected_answer",
  "langevals/llm_answer_match": "expected_answer",
  "ragas/factual_correctness": "expected_answer",
  "ragas/rouge_score": "expected_answer",
  "ragas/bleu_score": "expected_answer",
  "langevals/llm_boolean": "llm_judge",
  "langevals/llm_score": "llm_judge",
  "langevals/llm_category": "llm_judge",
  "ragas/rubrics_based_scoring": "llm_judge",
  "ragas/faithfulness": "rag",
  "ragas/response_relevancy": "rag",
  "ragas/response_context_recall": "rag",
  "ragas/response_context_precision": "rag",
  "ragas/context_f1": "rag",
  "langevals/sentiment": "quality",
  "lingua/language_detection": "quality",
  "ragas/summarization_score": "quality",
  "langevals/valid_format": "quality",
  "langevals/query_resolution": "quality",
  "ragas/sql_query_equivalence": "quality",
  "presidio/pii_detection": "safety",
  "langwatch/api_keys_and_secrets_detection": "safety",
  "azure/prompt_injection": "safety",
  "azure/jailbreak": "safety",
  "azure/content_safety": "safety",
  "openai/moderation": "safety",
  "langevals/competitor_blocklist": "safety",
  "langevals/competitor_llm": "safety",
  "langevals/competitor_llm_function_call": "safety",
  "langevals/off_topic": "safety",
  "langevals/basic": "ignored",
  "langevals/similarity": "ignored",
  "langevals/pairwise_compare": "ignored",
  "langevals/select_best_compare": "ignored",
  "ragas/context_precision": "ignored",
  "ragas/context_recall": "ignored",
};

export type EvaluatorAvailability = {
  missingEnvVars?: readonly string[];
  unavailable?: { reason: string; howToEnable: string };
};

export type EvaluatorTypePickerProps = {
  category?: EvaluatorCategoryId;
  availability?: Readonly<Partial<Record<string, EvaluatorAvailability>>>;
  onSelect: (evaluatorType: EvaluatorTypes) => void;
  onConfigureAzureSafety?: () => void;
  evaluators?: Readonly<Partial<Record<EvaluatorTypes, EvaluatorDefinition>>>;
};

export function EvaluatorTypePicker({
  category,
  availability,
  onSelect,
  onConfigureAzureSafety,
  evaluators = AVAILABLE_EVALUATORS,
}: EvaluatorTypePickerProps) {
  const evaluatorTypes = (Object.keys(evaluatorCategoryMap) as EvaluatorTypes[])
    .filter(
      (evaluatorType) =>
        evaluatorCategoryMap[evaluatorType] === category &&
        evaluators[evaluatorType],
    );

  return (
    <VStack gap={4} align="stretch" flex={1} overflow="hidden">
      <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
        Select an evaluator to configure and save.
      </Text>
      <VStack
        gap={3}
        align="stretch"
        paddingX={6}
        paddingBottom={4}
        overflowY="auto"
      >
        {evaluatorTypes.map((evaluatorType) => {
          const evaluator = evaluators[evaluatorType]!;
          const available = availability?.[evaluatorType];
          const unavailable = available?.unavailable;
          const isAzureEvaluator = evaluatorType.startsWith("azure/");
          const isDisabled =
            Boolean(unavailable) ||
            (isAzureEvaluator && (available?.missingEnvVars?.length ?? 0) > 0);

          return (
            <EvaluatorTypeCard
              key={evaluatorType}
              evaluatorType={evaluatorType}
              name={evaluator.name}
              description={evaluator.description}
              disabled={isDisabled}
              disabledTooltip={
                unavailable
                  ? `${unavailable.reason} ${unavailable.howToEnable}`
                  : isDisabled
                    ? "Configure Azure Safety provider in Settings → Model Providers"
                    : undefined
              }
              disabledCta={
                isDisabled && !unavailable && onConfigureAzureSafety
                  ? {
                      label: "Configure Azure Safety",
                      onClick: onConfigureAzureSafety,
                    }
                  : undefined
              }
              onClick={() => onSelect(evaluatorType)}
            />
          );
        })}
      </VStack>
    </VStack>
  );
}

function EvaluatorTypeCard({
  evaluatorType,
  name,
  description,
  disabled,
  disabledTooltip,
  disabledCta,
  onClick,
}: {
  evaluatorType: string;
  name: string;
  description: string;
  disabled: boolean;
  disabledTooltip?: string;
  disabledCta?: { label: string; onClick: () => void };
  onClick: () => void;
}) {
  const testId = `evaluator-type-${evaluatorType.replace("/", "-")}`;

  return (
    <Box
      as={disabled ? "div" : "button"}
      title={disabled ? disabledTooltip : undefined}
      onClick={disabled ? undefined : onClick}
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor="border"
      bg={disabled ? "gray.50" : "bg.panel"}
      color={disabled ? "gray.400" : undefined}
      cursor={disabled ? "default" : "pointer"}
      textAlign="left"
      width="full"
      _hover={
        disabled ? undefined : { borderColor: "green.muted", bg: "green.subtle" }
      }
      transition="all 0.15s"
      data-testid={testId}
      data-disabled={disabled ? "true" : undefined}
    >
      <VStack align="start" gap={2}>
        <Text fontWeight="500" fontSize="sm">
          {name}
        </Text>
        <Text fontSize="xs" color={disabled ? "gray.400" : "fg.muted"} lineClamp={2}>
          {description}
        </Text>
        {disabledCta && (
          <Button
            variant="plain"
            size="xs"
            height="auto"
            padding={0}
            color="orange.600"
            fontSize="xs"
            fontWeight="500"
            onClick={(event) => {
              event.stopPropagation();
              disabledCta.onClick();
            }}
            data-testid={`${testId}-cta`}
          >
            <HStack gap={1}>
              <Text>{disabledCta.label}</Text>
              <LuExternalLink size={12} />
            </HStack>
          </Button>
        )}
      </VStack>
    </Box>
  );
}

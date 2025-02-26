import {
  Badge,
  Box,
  Grid,
  GridItem,
  HStack,
  Heading,
  Tabs,
  Tag,
  Text,
  VStack,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { Shield, Plus } from "react-feather";
import type { UseFormReturn } from "react-hook-form";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import { isFeatureEnabled } from "../../utils/featureFlags";
import { titleCase } from "../../utils/stringCasing";
import type { CheckConfigFormData } from "./CheckConfigForm";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { useRouter } from "next/router";

type Category = EvaluatorDefinition<any>["category"];

// Temporary name map before we have support for grouping evaluations together
export const evaluatorTempNameMap: Record<string, string> = {
  "Azure Content Safety": "Content Safety",
  "OpenAI Moderation": "Moderation",
  "Azure Jailbreak Detection": "Jailbreak Detection",
  "Presidio PII Detection": "PII Detection",
  "Lingua Language Detection": "Language Detection",
  "Azure Prompt Shield": "Prompt Injection Detection",
};

const sortingOrder = [
  // rag,
  "ragas/faithfulness",
  "ragas/response_context_precision",
  "ragas/response_context_recall",

  // quality,
  "ragas/response_relevancy",
  "ragas/summarization_score",
  "lingua/language_detection",
  "langevals/valid_format",
  "ragas/factual_correctness",
];

export function EvaluatorSelection({
  form,
}: {
  form: UseFormReturn<CheckConfigFormData>;
}) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const tab = (router.query.tab as Category | undefined) ?? "safety";

  const availableEvaluators_ = api.evaluations.availableEvaluators.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const availableCustomEvaluators =
    api.evaluations.availableCustomEvaluators.useQuery(
      { projectId: project?.id ?? "" },
      { enabled: !!project }
    );

  const availableEvaluators = [
    ...Object.entries(availableEvaluators_.data ?? AVAILABLE_EVALUATORS)
      .filter(
        ([key, _evaluator]) =>
          !key.startsWith("example/") && !key.startsWith("legacy/")
      )
      .sort(([key, _evaluator], [key2, _evaluator2]) => {
        const index = sortingOrder.indexOf(key);
        const index2 = sortingOrder.indexOf(key2);
        if (index === -1) return 999;
        if (index2 === -1) return -999;
        return index - index2;
      }),
    ...(availableCustomEvaluators.data ?? []).map((evaluator) => [
      `custom/${evaluator.id}`,
      {
        name: evaluator.name,
        description: evaluator.description,
        category: "custom",
        requiredFields: [],
      },
    ]),
  ];

  const categories: Category[] = [
    "safety",
    "policy",
    "rag",
    "quality",
    "custom",
  ];

  const availableEvaluatorsPerCategory: Record<
    string,
    Array<
      [
        string,
        EvaluatorDefinition<any> & {
          beta?: boolean;
          missingEnvVars?: string[];
        },
      ]
    >
  > = {};

  for (const category of categories) {
    availableEvaluatorsPerCategory[category] = availableEvaluators.filter(
      (entry): entry is [string, EvaluatorDefinition<any>] =>
        Array.isArray(entry) &&
        typeof entry[1] === "object" &&
        "category" in entry[1] &&
        entry[1].category === category
    );
  }

  if (isFeatureEnabled("NEXT_PUBLIC_FEATURE_BETA_ANNOTATIONS_TRAINED")) {
    availableEvaluatorsPerCategory.custom!.push([
      "custom",
      {
        name: "Automated Annotations Evaluator",
        description:
          "Optimize your own evaluator, fine-tuned on your project's annotation scores to mimic human review scores and reasoning and automatically evaluate messages just like your team members would",
        category: "custom",
        isGuardrail: false,
        requiredFields: [],
        optionalFields: [],
        settings: {},
        result: {},
        beta: true,
        envVars: [],
        missingEnvVars: [],
      },
    ]);
  }

  return (
    <Tabs.Root
      colorPalette="orange"
      defaultValue={tab}
      value={tab}
      onValueChange={(change) => {
        void router.replace({
          pathname: router.pathname,
          query: { ...router.query, tab: change.value },
        });
      }}
    >
      <Tabs.List>
        {Object.keys(availableEvaluatorsPerCategory).map((category) => (
          <Tabs.Trigger key={category} value={category}>
            {titleCase(category)}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {Object.entries(availableEvaluatorsPerCategory).map(
        ([category, evaluators]) => (
          <Tabs.Content key={category} value={category} paddingX={0}>
            <Grid templateColumns="repeat(3, 1fr)" gap={6}>
              {evaluators.map(([key, evaluator]) => {
                const isDisabled =
                  evaluator.missingEnvVars &&
                  evaluator.missingEnvVars.length > 0;

                return (
                  <GridItem
                    key={key}
                    width="full"
                    padding={6}
                    borderRadius={6}
                    boxShadow="0px 4px 10px 0px rgba(0, 0, 0, 0.06)"
                    cursor={isDisabled ? "default" : "pointer"}
                    role="button"
                    _hover={
                      isDisabled
                        ? undefined
                        : {
                            background: "gray.200",
                          }
                    }
                    onClick={() => {
                      if (isDisabled) return;
                      form.setValue("checkType", key as EvaluatorTypes);
                      void router.push({
                        pathname: router.pathname.replace("/choose", ""),
                        query: router.query,
                      });
                    }}
                    color={isDisabled ? "gray.400" : undefined}
                    background={isDisabled ? "gray.50" : "white"}
                  >
                    <VStack align="start" gap={4} position="relative">
                      {evaluator.isGuardrail && (
                        <Tooltip
                          content="This evaluator can be used as a guardrail"
                          positioning={{ placement: "top" }}
                        >
                          <Box
                            position="absolute"
                            right="-12px"
                            top="-12px"
                            background="blue.100"
                            borderRadius="100%"
                            padding="4px"
                          >
                            <Shield />
                          </Box>
                        </Tooltip>
                      )}
                      <HStack>
                        {evaluator.beta && (
                          <Tag.Root
                            size="sm"
                            colorPalette="pink"
                            paddingX={2}
                            fontSize="14px"
                            marginLeft="-4px"
                          >
                            <Tag.Label>Beta</Tag.Label>
                          </Tag.Root>
                        )}
                        <Heading as="h2" size="sm">
                          {evaluatorTempNameMap[evaluator.name] ??
                            evaluator.name}
                        </Heading>
                      </HStack>
                      {evaluator.missingEnvVars &&
                        evaluator.missingEnvVars.length > 0 && (
                          <Tooltip
                            content={evaluator.missingEnvVars.join(", ")}
                            positioning={{ placement: "top" }}
                          >
                            <Tag.Root
                              colorPalette="orange"
                              borderRadius="8px"
                              padding="4px 8px"
                              lineHeight="1.5em"
                            >
                              <Tag.Label>
                                Evaluator disabled, missing env vars
                              </Tag.Label>
                            </Tag.Root>
                          </Tooltip>
                        )}
                      <Text>
                        {evaluator.description.replace(
                          "Google DLP PII detects",
                          "Detects"
                        )}
                      </Text>
                      <HStack wrap="wrap">
                        {evaluator.requiredFields.includes("contexts") && (
                          <Link
                            asChild
                            href="https://docs.langwatch.ai/rags/rags-context-tracking"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <NextLink href="https://docs.langwatch.ai/rags/rags-context-tracking">
                              <Tooltip
                                content="Only messages with contexts can run this evaluation, click for more info"
                                positioning={{ placement: "top" }}
                              >
                                <Badge
                                  colorPalette="orange"
                                  whiteSpace="nowrap"
                                >
                                  Requires Contexts
                                </Badge>
                              </Tooltip>
                            </NextLink>
                          </Link>
                        )}
                        {evaluator.requiredFields.includes(
                          "expected_output"
                        ) && (
                          <Link
                            asChild
                            href="https://docs.langwatch.ai/docs/expected_output"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <NextLink href="https://docs.langwatch.ai/docs/expected_output">
                              <Tooltip
                                content="Only messages with expected outputs can run this evaluation, click for more info"
                                positioning={{ placement: "top" }}
                              >
                                <Badge
                                  colorPalette="blue"
                                  backgroundColor="blue.50"
                                  color="blue.700"
                                  whiteSpace="nowrap"
                                >
                                  Requires Expected Output
                                </Badge>
                              </Tooltip>
                            </NextLink>
                          </Link>
                        )}
                        {evaluator.requiredFields.includes(
                          "expected_contexts"
                        ) && (
                          <Link
                            asChild
                            href="https://docs.langwatch.ai/docs/expected_contexts"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <NextLink href="https://docs.langwatch.ai/docs/expected_contexts">
                              <Tooltip
                                content="Only messages with expected contexts can run this evaluation, click for more info"
                                positioning={{ placement: "top" }}
                              >
                                <Badge
                                  colorPalette="purple"
                                  backgroundColor="purple.50"
                                  color="purple.700"
                                  whiteSpace="nowrap"
                                >
                                  Requires Expected Contexts
                                </Badge>
                              </Tooltip>
                            </NextLink>
                          </Link>
                        )}
                      </HStack>
                    </VStack>
                  </GridItem>
                );
              })}

              {category === "custom" && (
                <GridItem
                  as={Link}
                  //@ts-ignore
                  href={`/${project?.slug}/workflows`}
                  border="dashed"
                  borderColor="gray.300"
                  borderWidth={3}
                  borderRadius={6}
                  padding={6}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  minHeight="200px"
                  _hover={{
                    background: "gray.50",
                    textDecoration: "none",
                  }}
                >
                  <VStack gap={3}>
                    <Box p={3} borderRadius="full" bg="gray.100">
                      <Plus size={24} color="gray" />
                    </Box>
                    <Text color="gray.600">Create Custom Evaluator</Text>
                  </VStack>
                </GridItem>
              )}
            </Grid>
          </Tabs.Content>
        )
      )}
    </Tabs.Root>
  );
}

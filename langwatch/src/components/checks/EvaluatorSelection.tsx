import {
  Box,
  Grid,
  GridItem,
  HStack,
  Heading,
  Link,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { Shield } from "react-feather";
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
import { Plus } from "react-feather";

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
    <Tabs
      colorScheme="orange"
      index={categories.indexOf(tab)}
      onChange={(index) => {
        void router.replace({
          pathname: router.pathname,
          query: { ...router.query, tab: categories[index] },
        });
      }}
    >
      <TabList>
        {Object.keys(availableEvaluatorsPerCategory).map((category) => (
          <Tab key={category}>{titleCase(category)}</Tab>
        ))}
      </TabList>
      <TabPanels>
        {Object.entries(availableEvaluatorsPerCategory).map(
          ([category, evaluators]) => (
            <TabPanel key={category} paddingX={0}>
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
                      <VStack align="start" spacing={4} position="relative">
                        {evaluator.isGuardrail && (
                          <Tooltip label="This evaluator can be used as a guardrail">
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
                            <Tag
                              size="sm"
                              colorScheme="pink"
                              paddingX={2}
                              fontSize="14px"
                              marginLeft="-4px"
                            >
                              Beta
                            </Tag>
                          )}
                          <Heading as="h2" size="sm">
                            {evaluatorTempNameMap[evaluator.name] ??
                              evaluator.name}
                          </Heading>
                        </HStack>
                        {evaluator.missingEnvVars &&
                          evaluator.missingEnvVars.length > 0 && (
                            <Tooltip
                              label={evaluator.missingEnvVars.join(", ")}
                            >
                              <Tag
                                colorScheme="orange"
                                borderRadius="8px"
                                padding="4px 8px"
                                lineHeight="1.5em"
                              >
                                Evaluator disabled, missing env vars
                              </Tag>
                            </Tooltip>
                          )}
                        {/* <VStack align="start" spacing={1}>
                          {(evaluator.missingEnvVars ?? []).map((envVar) => (
                            <Tag colorScheme="red" key={envVar} fontSize="12px" paddingX={2}>
                              Missing {envVar}
                            </Tag>
                          ))}
                        </VStack> */}
                        <Text>
                          {/* TODO: temporary change for Google DLP PII */}
                          {evaluator.description.replace(
                            "Google DLP PII detects",
                            "Detects"
                          )}
                        </Text>
                        <HStack wrap="wrap">
                          {evaluator.requiredFields.includes("contexts") && (
                            <Link
                              href="https://docs.langwatch.ai/rags/rags-context-tracking"
                              target="_blank"
                            >
                              <Tooltip label="Only messages with contexts can run this evaluation, click for more info">
                                <Tag colorScheme="orange" whiteSpace="nowrap">
                                  Requires Contexts
                                </Tag>
                              </Tooltip>
                            </Link>
                          )}
                          {evaluator.requiredFields.includes(
                            "expected_output"
                          ) && (
                            <Link
                              href="https://docs.langwatch.ai/docs/expected_output"
                              target="_blank"
                            >
                              <Tooltip label="Only messages with expected outputs can run this evaluation, click for more info">
                                <Tag
                                  backgroundColor="blue.50"
                                  color="blue.700"
                                  whiteSpace="nowrap"
                                >
                                  Requires Expected Output
                                </Tag>
                              </Tooltip>
                            </Link>
                          )}
                          {evaluator.requiredFields.includes(
                            "expected_contexts"
                          ) && (
                            <Tooltip label="Only messages with expected contexts can run this evaluation, click for more info">
                              <Tag
                                backgroundColor="purple.50"
                                color="purple.700"
                                whiteSpace="nowrap"
                              >
                                Requires Expected Contexts
                              </Tag>
                            </Tooltip>
                          )}
                        </HStack>
                      </VStack>
                    </GridItem>
                  );
                })}

                {category === "custom" && (
                  <GridItem
                    as={Link}
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
                    <VStack spacing={3}>
                      <Box p={3} borderRadius="full" bg="gray.100">
                        <Plus size={24} color="gray" />
                      </Box>
                      <Text color="gray.600">Create Custom Evaluator</Text>
                    </VStack>
                  </GridItem>
                )}
              </Grid>
            </TabPanel>
          )
        )}
      </TabPanels>
    </Tabs>
  );
}

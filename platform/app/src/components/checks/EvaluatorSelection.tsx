import {
  Alert,
  Badge,
  Box,
  Grid,
  GridItem,
  Heading,
  HStack,
  Tabs,
  Tag,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertTriangle, Plus, Shield } from "react-feather";
import type { UseFormReturn } from "react-hook-form";
import NextLink from "~/utils/compat/next-link";
import { useRouter } from "~/utils/compat/next-router";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { evaluatorDisplayName } from "../../server/evaluations/evaluatorDisplayNames";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators";
import { api } from "../../utils/api";
import { isFeatureEnabled } from "../../utils/featureFlags";
import { titleCase } from "../../utils/stringCasing";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import type { CheckConfigFormData } from "./CheckConfigForm";

type Category = EvaluatorDefinition<any>["category"];

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
  retiredEvaluatorType,
}: {
  form: UseFormReturn<CheckConfigFormData>;
  /**
   * The saved evaluator type of the monitor being edited, when it is no longer
   * in the catalog. Named in a notice so the user knows which evaluator they
   * are replacing.
   */
  retiredEvaluatorType?: string;
}) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const tab = (router.query.tab as Category | undefined) ?? "safety";

  const availableEvaluators_ = api.evaluations.availableEvaluators.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const availableCustomEvaluators =
    api.evaluations.availableCustomEvaluators.useQuery(
      { projectId: project?.id ?? "" },
      { enabled: !!project },
    );

  const availableEvaluators = [
    ...Object.entries(availableEvaluators_.data ?? AVAILABLE_EVALUATORS)
      .filter(([key, _evaluator]) => !key.startsWith("example/"))
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
          unavailable?: { reason: string; howToEnable: string };
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
        entry[1].category === category,
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
    <VStack align="stretch" gap={4} width="full">
      {retiredEvaluatorType && (
        <Alert.Root status="warning">
          <Alert.Indicator>
            <AlertTriangle size={16} />
          </Alert.Indicator>
          <Box flex="1">
            <Alert.Title>This evaluator is no longer available</Alert.Title>
            <Alert.Description>
              {`This evaluation was set up with ${retiredEvaluatorType}. Pick a replacement below to start getting results again.`}
            </Alert.Description>
          </Box>
        </Alert.Root>
      )}
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
                  // Two different reasons a card cannot be picked: the
                  // evaluator is not installed on this server at all, or it is
                  // installed but not configured. They read differently and are
                  // fixed differently, so they are shown differently.
                  const isDisabled =
                    !!evaluator.unavailable ||
                    (evaluator.missingEnvVars &&
                      evaluator.missingEnvVars.length > 0);

                  const choose = () => {
                    if (isDisabled) return;
                    form.setValue("checkType", key as EvaluatorTypes);
                    void router.push({
                      pathname: router.pathname.replace("/choose", ""),
                      query: router.query,
                    });
                  };

                  return (
                    <GridItem
                      key={key}
                      width="full"
                      padding={6}
                      borderRadius={6}
                      boxShadow="0px 4px 10px 0px rgba(0, 0, 0, 0.06)"
                      cursor={isDisabled ? "default" : "pointer"}
                      role="button"
                      // A card is the only way to pick an evaluator, including
                      // for someone recovering an evaluation whose evaluator is
                      // gone, so it takes focus and answers the keys a button
                      // answers. A disabled card stays in the tab order and says
                      // so, rather than silently doing nothing when activated.
                      tabIndex={0}
                      aria-disabled={isDisabled ? true : undefined}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        choose();
                      }}
                      _hover={
                        isDisabled
                          ? undefined
                          : {
                              background: "gray.200",
                            }
                      }
                      onClick={choose}
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
                            {evaluatorDisplayName(evaluator.name)}
                          </Heading>
                        </HStack>
                        {evaluator.unavailable && (
                          <Tooltip
                            content={evaluator.unavailable.howToEnable}
                            positioning={{ placement: "top" }}
                          >
                            <Tag.Root
                              colorPalette="orange"
                              borderRadius="8px"
                              padding="4px 8px"
                              lineHeight="1.5em"
                            >
                              <Tag.Label>Not available here</Tag.Label>
                            </Tag.Root>
                          </Tooltip>
                        )}
                        {!evaluator.unavailable &&
                          evaluator.missingEnvVars &&
                          evaluator.missingEnvVars.length > 0 && (
                            <Tooltip
                              // The names are the actionable part for whoever
                              // runs the install, so the tooltip keeps them.
                              content={`Set these environment variables to enable it: ${evaluator.missingEnvVars.join(", ")}`}
                              positioning={{ placement: "top" }}
                            >
                              <Tag.Root
                                colorPalette="orange"
                                borderRadius="8px"
                                padding="4px 8px"
                                lineHeight="1.5em"
                              >
                                <Tag.Label>Needs configuration</Tag.Label>
                              </Tag.Root>
                            </Tooltip>
                          )}
                        <Text>
                          {evaluator.description.replace(
                            "Google DLP PII detects",
                            "Detects",
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
                            "expected_output",
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
                            "expected_contexts",
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
                    borderColor="border.emphasized"
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
                      <Box p={3} borderRadius="full" bg="bg.muted">
                        <Plus size={24} color="gray" />
                      </Box>
                      <Text color="fg.muted">Create Custom Evaluator</Text>
                    </VStack>
                  </GridItem>
                )}
              </Grid>
            </Tabs.Content>
          ),
        )}
      </Tabs.Root>
    </VStack>
  );
}

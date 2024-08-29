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
} from "../../evaluations/evaluators.generated";
import { isFeatureEnabled } from "../../utils/featureFlags";
import { titleCase } from "../../utils/stringCasing";
import type { CheckConfigFormData } from "./CheckConfigForm";

type Category = EvaluatorDefinition<any>["category"];

// Temporary name map before we have support for grouping evaluations together
export const evaluatorTempNameMap: Record<string, string> = {
  "Azure Content Safety": "Content Safety",
  "OpenAI Moderation": "Moderation",
  "Azure Jailbreak Detection": "Jailbreak Detection",
  "Google Cloud DLP PII Detection": "PII Detection",
  "Lingua Language Detection": "Language Detection",
  "Azure Prompt Shield": "Prompt Injection Detection",
};

export function EvaluatorSelection({
  form,
}: {
  form: UseFormReturn<CheckConfigFormData>;
}) {
  const router = useRouter();

  const tab = (router.query.tab as Category | undefined) ?? "safety";

  const availableEvaluators = Object.entries(AVAILABLE_EVALUATORS).filter(
    ([key, _evaluator]) =>
      !key.startsWith("example/") &&
      key !== "aws/comprehend_pii_detection"
  );

  const categories: Category[] = ["safety", "policy", "quality", "custom"];

  const availableEvaluatorsPerCategory: Record<
    string,
    Array<[string, EvaluatorDefinition<any> & { beta?: boolean }]>
  > = {};

  for (const category of categories) {
    availableEvaluatorsPerCategory[category] = availableEvaluators.filter(
      ([_, evaluator]) =>
        evaluator.category === category ||
        (evaluator.category === "rag" && category === "quality") // Merge RAG into quality for now
    );
  }

  if (isFeatureEnabled("NEXT_PUBLIC_FEATURE_BETA_ANNOTATIONS_TRAINED")) {
    availableEvaluatorsPerCategory.custom!.push([
      "custom",
      {
        name: "Automated Annotations Evaluator",
        description:
          "Train your own evaluator, fine-tuned on your project's annotation scores to mimic human review scores and reasoning and automatically evaluate messages just like your team members would",
        category: "custom",
        isGuardrail: false,
        requiredFields: [],
        optionalFields: [],
        settings: {},
        result: {},
        beta: true,
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
                {evaluators.map(([key, evaluator]) => (
                  <GridItem
                    key={key}
                    width="full"
                    background="white"
                    padding={6}
                    borderRadius={6}
                    boxShadow="0px 4px 10px 0px rgba(0, 0, 0, 0.06)"
                    cursor="pointer"
                    role="button"
                    _hover={{
                      background: "gray.200",
                    }}
                    onClick={() => {
                      form.setValue("checkType", key as EvaluatorTypes);
                      void router.push({
                        pathname: router.pathname.replace("/choose", ""),
                        query: router.query,
                      });
                    }}
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
                          <Tag size="sm" colorScheme="pink" paddingX={2} fontSize="14px" marginLeft="-4px">
                            Beta
                          </Tag>
                        )}
                        <Heading as="h2" size="sm">
                          {evaluatorTempNameMap[evaluator.name] ??
                            evaluator.name}
                        </Heading>
                      </HStack>
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
                                Requires RAG
                              </Tag>
                            </Tooltip>
                          </Link>
                        )}
                        {evaluator.requiredFields.includes("expected_output") && (
                          <Link
                            href="https://docs.langwatch.ai/docs/expected_output"
                            target="_blank"
                          >
                            <Tooltip label="Only messages with expected outputs can run this evaluation, click for more info">
                              <Tag backgroundColor="blue.50" color="blue.700" whiteSpace="nowrap">
                                Requires Expected Output
                              </Tag>
                            </Tooltip>
                          </Link>
                        )}
                      </HStack>
                    </VStack>
                  </GridItem>
                ))}
              </Grid>
            </TabPanel>
          )
        )}
      </TabPanels>
    </Tabs>
  );
}

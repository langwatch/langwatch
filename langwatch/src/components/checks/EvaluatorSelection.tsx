import {
  Box,
  Grid,
  GridItem,
  VStack,
  Text,
  Heading,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  HStack,
  Link,
  Tooltip,
} from "@chakra-ui/react";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "../../trace_checks/evaluators.generated";
import type { CheckConfigFormData } from "./CheckConfigForm";
import type { UseFormReturn } from "react-hook-form";
import { useRouter } from "next/router";
import { titleCase } from "../../utils/stringCasing";
import { Shield } from "react-feather";

type Category = EvaluatorDefinition<any>["category"];

export function EvaluatorSelection({
  form,
}: {
  form: UseFormReturn<CheckConfigFormData>;
}) {
  const router = useRouter();

  const tab = (router.query.tab as Category | undefined) ?? "safety";

  const availableEvaluators = Object.entries(AVAILABLE_EVALUATORS).filter(
    ([key, evaluator]) =>
      !evaluator.requiredFields.includes("expected_output") &&
      !key.startsWith("example/") &&
      key !== "aws/comprehend_pii_detection"
  );

  const categories: Category[] = ["safety", "quality", "custom"];

  const availableEvaluatorsPerCategory: Record<
    string,
    Array<[string, EvaluatorDefinition<any>]>
  > = {};

  for (const category of categories) {
    availableEvaluatorsPerCategory[category] = availableEvaluators.filter(
      ([_, evaluator]) =>
        evaluator.category === category ||
        (evaluator.category === "rag" && category === "quality") // Merge RAG into quality for now
    );
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
                      <Heading as="h2" size="sm">
                        {evaluator.name}
                      </Heading>
                      <Text>{evaluator.description}</Text>
                      <HStack>
                        {evaluator.requiredFields.includes("contexts") && (
                          <Link
                            href="https://docs.langwatch.ai/docs/rag/capture_rag"
                            target="_blank"
                          >
                            <Tooltip label="Only messages with contexts can run this evaluation, click for more info">
                              <Tag colorScheme="orange">Requires RAG</Tag>
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

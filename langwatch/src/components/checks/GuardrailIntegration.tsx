import {
  Box,
  Heading,
  VStack,
  Tab,
  Tabs,
  TabList,
  TabPanels,
  Text,
  TabPanel,
  Tag,
  HStack,
} from "@chakra-ui/react";
import { RenderCode } from "../integration-guides/utils/RenderCode";
import type {
  AVAILABLE_EVALUATORS,
  EvaluatorTypes,
  Evaluators,
} from "../../trace_checks/evaluators.generated";

export function GuardrailIntegration({
  slug,
  evaluatorDefinition,
}: {
  slug: string;
  evaluatorDefinition: (typeof AVAILABLE_EVALUATORS)[keyof typeof AVAILABLE_EVALUATORS];
}) {
  const contextsParams = evaluatorDefinition.requiredFields.includes("contexts")
    ? `\n    contexts=["retrieved snippet 1", "retrieved snippet 2"],`
    : evaluatorDefinition.optionalFields.includes("contexts")
    ? `\n    contexts=["retrieved snippet 1", "retrieved snippet 2"], # optional`
    : "";
  const inputParams = evaluatorDefinition.requiredFields.includes("input")
    ? `\n    input=user_input,`
    : evaluatorDefinition.optionalFields.includes("input")
    ? `\n    input=user_input, # optional`
    : "";
  const isOutputMandatory =
    evaluatorDefinition.requiredFields.includes("output");
  const isOutputOptional =
    evaluatorDefinition.optionalFields.includes("output");

  const PythonInstructions = ({ async }: { async: boolean }) => (
    <VStack align="start" width="full" spacing={3}>
      <Text fontSize={14}>
        Add this import at the top of the file where the LLM call happens:
      </Text>
      <Box className="markdown" width="full">
        <RenderCode code={`import langwatch.guardrails `} language="python" />
      </Box>
      {!isOutputMandatory && (
        <>
          <Text fontSize={14}>
            Then, right before calling your LLM, check for the guardrail:
          </Text>
          <Box className="markdown" width="full">
            <RenderCode
              code={`guardrail = ${
                async
                  ? "await langwatch.guardrails.async_evaluate"
                  : "langwatch.guardrails.evaluate"
              }(
    "${slug}",
    input=user_input,${contextsParams}
)
if not guardrail.passed:
    # handle the guardrail here
    return "I'm sorry, I can't do that."`}
              language="python"
            />
          </Box>
        </>
      )}
      {isOutputMandatory && (
        <Text fontSize={14}>
          Then, after generating the response from the LLM, check for the
          guardrail:
        </Text>
      )}
      {isOutputOptional && (
        <Text fontSize={14}>
          (Optional) You can check for the guardrail after generating the
          response from the LLM instead, to validate the output:
        </Text>
      )}
      {(isOutputMandatory || isOutputOptional) && (
        <Box className="markdown" width="full">
          <RenderCode
            code={`result = completion.choices[0].message

guardrail = ${
              async
                ? "await langwatch.guardrails.async_evaluate"
                : "langwatch.guardrails.evaluate"
            }(
    "${slug}",${inputParams}
    output=result,${contextsParams}
)
if not guardrail.passed:
    # handle the guardrail here
    return "I'm sorry, I can't do that."`}
            language="python"
          />
        </Box>
      )}
    </VStack>
  );

  return (
    <VStack spacing={4} align="start" width="full">
      <Heading as="h4" fontSize={16} fontWeight={500} paddingTop={4}>
        Guardrail Integration
      </Heading>
      <HStack>
        <Text fontSize={14}>This guardrail requires:</Text>
        {evaluatorDefinition.requiredFields
          .map((field) => (
            <Tag key={field} colorScheme="blue">
              {field}
            </Tag>
          ))
          .concat(
            evaluatorDefinition.optionalFields.map((field) => (
              <Tag key={field}>{field} (optional)</Tag>
            ))
          )}
      </HStack>
      <Text fontSize={14}>
        Follow the code example below to integrate this guardrail in your LLM
        pipeline, save changes first for the guardrail to work.
      </Text>
      <Tabs width="full">
        <TabList marginBottom={4}>
          <Tab>Python</Tab>
          <Tab>Python (Async)</Tab>
          {/* <Tab>REST API</Tab> */}
        </TabList>

        <TabPanels>
          <TabPanel padding={0}>
            <PythonInstructions async={false} />
          </TabPanel>
          <TabPanel padding={0}>
            <PythonInstructions async={true} />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </VStack>
  );
}

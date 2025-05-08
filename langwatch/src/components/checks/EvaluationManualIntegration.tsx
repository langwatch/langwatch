import {
  Box,
  HStack,
  Heading,
  Tag,
  Text,
  VStack,
  Tabs,
} from "@chakra-ui/react";
import { Checkbox } from "../ui/checkbox";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type {
  AVAILABLE_EVALUATORS,
} from "../../server/evaluations/evaluators.generated";
import { api } from "../../utils/api";
import { RenderCode } from "../code/RenderCode";
import { langwatchEndpoint } from "../code/langwatchEndpointEnv";
import { EvaluationExecutionMode } from "@prisma/client";
import type { UseFormReturn } from "react-hook-form";
import type { CheckConfigFormData } from "./CheckConfigForm";
import { Info } from "react-feather";

export function EvaluationManualIntegration({
  slug,
  evaluatorDefinition,
  form,
  checkType,
  name,
  executionMode,
  settings,
  storeSettingsOnCode,
}: {
  slug?: string;
  evaluatorDefinition: (typeof AVAILABLE_EVALUATORS)[keyof typeof AVAILABLE_EVALUATORS];
  form?: UseFormReturn<CheckConfigFormData>;
  checkType: string;
  name: string;
  executionMode: EvaluationExecutionMode;
  settings: Record<string, unknown>;
  storeSettingsOnCode: boolean;
  checkSlug?: string;
}) {
  const isGuardrail = executionMode === EvaluationExecutionMode.AS_GUARDRAIL;
  const checkSlug = storeSettingsOnCode ? checkType : slug;

  const { project } = useOrganizationTeamProject();
  const isOutputMandatory =
    evaluatorDefinition.requiredFields.includes("output");
  const projectAPIKey = api.project.getProjectAPIKey.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    }
  );

  const PythonInstructions = ({ async }: { async: boolean }) => {
    const nameParam = storeSettingsOnCode ? `\n        name="${name}",` : "";
    const contextsParams = evaluatorDefinition.requiredFields.includes(
      "contexts"
    )
      ? `\n        contexts=["retrieved snippet 1", "retrieved snippet 2"],`
      : evaluatorDefinition.optionalFields.includes("contexts")
      ? `\n        contexts=["retrieved snippet 1", "retrieved snippet 2"], # optional`
      : "";
    const inputParams = evaluatorDefinition.requiredFields.includes("input")
      ? `\n        input=user_input,`
      : evaluatorDefinition.optionalFields.includes("input")
      ? `\n        input=user_input, # optional`
      : "";
    const outputParams = evaluatorDefinition.requiredFields.includes("output")
      ? `\n        output=generated_response,`
      : evaluatorDefinition.optionalFields.includes("output")
      ? `\n        output=generated_response, # optional`
      : "";
    const expectedOutputParams = evaluatorDefinition.requiredFields.includes(
      "expected_output"
    )
      ? `\n        expected_output=gold_answer,`
      : evaluatorDefinition.optionalFields.includes("expected_output")
      ? `\n        expected_output=gold_answer, # optional`
      : "";
    const conversationParams = evaluatorDefinition.requiredFields.includes(
      "conversation"
    )
      ? `\n        conversation=conversation_history,`
      : evaluatorDefinition.optionalFields.includes("conversation")
      ? `\n        conversation=conversation_history, # optional`
      : "";
    const settingsParams = storeSettingsOnCode
      ? `\n        settings=${JSON.stringify(settings ?? {}, null, 2)
          .replace(/true/g, "True")
          .replace(/false/g, "False")
          .split("\n")
          .map((line, index) => (index === 0 ? line : "        " + line))
          .join("\n")},`
      : "";

    return (
      <VStack align="start" width="full" gap={3}>
        <Text fontSize="14px">
          Add this import at the top of the file where the LLM call happens:
        </Text>
        <Box className="markdown" width="full">
          <RenderCode code={`import langwatch`} language="python" />
        </Box>
        {(!isOutputMandatory || !isGuardrail) && (
          <>
            <Text fontSize="14px">
              {isGuardrail
                ? isOutputMandatory
                  ? "Then, after calling your LLM, check for the guardrail:"
                  : "Then, either before or after calling your LLM, check for the guardrail:"
                : "Then, pass in the message data to get the result of the evaluator:"}
            </Text>
            <Box className="markdown" width="full">
              <RenderCode
                code={`@langwatch.span()
def llm_step():
    ... # your existing code

    ${isGuardrail ? "guardrail" : "result"} = ${
      async
        ? `await langwatch.get_current_span().async_evaluate`
        : `langwatch.get_current_span().evaluate`
    }(
        "${checkSlug}",${
          isGuardrail
            ? "\n        as_guardrail=True," +
              nameParam +
              "\n        input=user_input,"
            : nameParam + inputParams
        }${contextsParams}${outputParams}${expectedOutputParams}${conversationParams}${settingsParams}
    )
${
  isGuardrail
    ? `
    if not guardrail.passed:
        # handle the guardrail here
        return "I'm sorry, I can't do that."`
    : `
    print(result)`
}`}
                language="python"
              />
            </Box>
          </>
        )}
      </VStack>
    );
  };

  const TypeScriptInstructions = () => {
    const nameParam = storeSettingsOnCode ? `\n        name: "${name}",` : "";
    const contextsParams = evaluatorDefinition.requiredFields.includes(
      "contexts"
    )
      ? `\n        contexts: ["retrieved snippet 1", "retrieved snippet 2"],`
      : evaluatorDefinition.optionalFields.includes("contexts")
      ? `\n        contexts: ["retrieved snippet 1", "retrieved snippet 2"], // optional`
      : "";
    const inputParams = evaluatorDefinition.requiredFields.includes("input")
      ? `\n        input: message,`
      : evaluatorDefinition.optionalFields.includes("input")
      ? `\n        input: message, // optional`
      : "";
    const outputParams = evaluatorDefinition.requiredFields.includes("output")
      ? `\n        output: generatedResponse,`
      : evaluatorDefinition.optionalFields.includes("output")
      ? `\n        output: generatedResponse, // optional`
      : "";
    const expectedOutputParams = evaluatorDefinition.requiredFields.includes(
      "expected_output"
    )
      ? `\n        expectedOutput: goldAnswer,`
      : evaluatorDefinition.optionalFields.includes("expected_output")
      ? `\n        expectedOutput: goldAnswer, // optional`
      : "";
    const conversationParams = evaluatorDefinition.requiredFields.includes(
      "conversation"
    )
      ? `\n        conversation: conversationHistory,`
      : evaluatorDefinition.optionalFields.includes("conversation")
      ? `\n        conversation: conversationHistory, // optional`
      : "";
    const settingsParams = storeSettingsOnCode
      ? `\n        settings: ${JSON.stringify(settings ?? {}, null, 2)
          // remove quotes on json keys that have only safe characters in it
          .replace(/"(\w+)"\s*:/g, "$1:")
          .split("\n")
          .map((line, index) => (index === 0 ? line : "        " + line))
          .join("\n")},`
      : "";

    return (
      <VStack align="start" width="full" gap={3}>
        <Text fontSize="14px">
          First, set up your traces and spans capturing as explained in the{" "}
          <Link
            href="https://docs.langwatch.ai/integration/typescript/guide"
            isExternal
          >
            documentation
          </Link>
          .
        </Text>
        {(!isOutputMandatory || !isGuardrail) && (
          <>
            <Text fontSize="14px">
              {isGuardrail
                ? isOutputMandatory
                  ? "Then, after calling your LLM, check for the guardrail:"
                  : "Then, either before or after calling your LLM, check for the guardrail:"
                : "Then, pass in the message data to get the result of the evaluator:"}
            </Text>
            <Box className="markdown" width="full">
              <RenderCode
                code={`import { type LangWatchTrace } from "langwatch";

async function llmStep({ message, trace }: { message: string, trace: LangWatchTrace }): Promise<string> {
    const span = trace.startLLMSpan({ name: "llmStep" });
    ${isGuardrail ? "" : "\n    // ... your existing code\n"}
    // call the ${
      isGuardrail ? "guardrail" : "evaluator"
    } either on a span or on a trace
    const ${isGuardrail ? "guardrail" : "result"} = await span.evaluate({
        ${storeSettingsOnCode ? "evaluator:" : "slug:"} "${checkSlug}",${
          isGuardrail
            ? "\n        asGuardrail: true," +
              nameParam +
              "\n        input: message,"
            : nameParam + inputParams
        }${contextsParams}${outputParams}${expectedOutputParams}${conversationParams}${settingsParams}
    })
${
  isGuardrail
    ? `
    if (!guardrail.passed) {
        // handle the guardrail here
        return "I'm sorry, I can't do that.";
    }

    // ... your existing code`
    : `
    console.log(result);`
}`}
                language="typescript"
              />
            </Box>
          </>
        )}
      </VStack>
    );
  };

  const settingsParamsCurl = storeSettingsOnCode
    ? `,\n  "settings": ${JSON.stringify(settings ?? {}, null, 2)
        .split("\n")
        .map((line, index) => (index === 0 ? line : "  " + line))
        .join("\n")}`
    : "";

  return (
    <VStack gap={4} align="start" width="full">
      <Heading as="h4" fontSize="16px" fontWeight={500} paddingTop={4}>
        {executionMode === EvaluationExecutionMode.MANUALLY
          ? "Manual Integration"
          : "Guardrail Integration"}
      </Heading>
      <HStack>
        <Text fontSize="14px">
          This{" "}
          {executionMode === EvaluationExecutionMode.MANUALLY
            ? "evaluator"
            : "guardrail"}{" "}
          uses:
        </Text>
        {evaluatorDefinition.requiredFields
          .map((field) => (
            <Tag.Root key={field} colorPalette="blue">
              <Tag.Label>{field} (required)</Tag.Label>
            </Tag.Root>
          ))
          .concat(
            evaluatorDefinition.optionalFields.map((field) => (
              <Tag.Root key={field}>
                <Tag.Label>{field} (optional)</Tag.Label>
              </Tag.Root>
            ))
          )}
      </HStack>
      <Text fontSize="14px">
        Follow the code example below to integrate this{" "}
        {isGuardrail ? "guardrail" : "evaluator"} in your LLM pipeline, save
        changes first for the {isGuardrail ? "guardrail" : "evaluator"} to work.
      </Text>
      {form && (
        <HStack>
          <Checkbox {...form.register("storeSettingsOnCode")}>
            Store settings on code
          </Checkbox>
          <Tooltip
            content="Store the settings on the code to keep it versioned on your side instead of on LangWatch dashboard."
            positioning={{ placement: "top" }}
          >
            <Box>
              <Info size={16} />
            </Box>
          </Tooltip>
        </HStack>
      )}
      <Tabs.Root defaultValue="python" width="full" colorPalette="orange">
        <Tabs.List marginBottom={4}>
          <Tabs.Trigger value="python">Python</Tabs.Trigger>
          <Tabs.Trigger value="python-async">Python (Async)</Tabs.Trigger>
          <Tabs.Trigger value="typescript">TypeScript</Tabs.Trigger>
          <Tabs.Trigger value="curl">Curl</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="python" padding={0}>
          <PythonInstructions async={false} />
        </Tabs.Content>
        <Tabs.Content value="python-async" padding={0}>
          <PythonInstructions async={true} />
        </Tabs.Content>
        <Tabs.Content value="typescript" padding={0}>
          <TypeScriptInstructions />
        </Tabs.Content>
        <Tabs.Content value="curl" padding={0}>
          <VStack align="start" width="full" gap={3}>
            <Box className="markdown" width="full">
              <RenderCode
                code={`# Set your API key and endpoint URL
API_KEY="${projectAPIKey.data?.apiKey ?? "your_langwatch_api_key"}"

# Use curl to send the POST request, e.g.:
curl -X POST "${langwatchEndpoint()}/api/evaluations/${checkSlug}/evaluate" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
{
  "trace_id": "trace-123",
  "data": {
    ${evaluatorDefinition.requiredFields
      .map((field) => `"${field}": "${field} content"`)
      .concat(
        evaluatorDefinition.optionalFields.map(
          (field) => `"${field}": "${field} content (optional)"`
        )
      )
      .join(",\n    ")}
  }${isGuardrail ? `,\n  "as_guardrail": true` : ""}${settingsParamsCurl}
}
EOF`}
                language="bash"
              />
            </Box>
            <Text>Response:</Text>
            <Box className="markdown" width="full">
              <RenderCode
                code={JSON.stringify(
                  {
                    status: "processed",
                    passed: true,
                    score: 1,
                    details: "possible explanation",
                  },
                  null,
                  2
                )}
                language="json"
              />
            </Box>
          </VStack>
        </Tabs.Content>
      </Tabs.Root>
    </VStack>
  );
}

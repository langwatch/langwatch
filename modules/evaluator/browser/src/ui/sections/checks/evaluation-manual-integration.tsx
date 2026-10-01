import { useMintPersonalToken } from "@langwatch/api-key-client";
import { useOptionalUiCapabilities } from "@langwatch/browser-host/capabilities";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { Link } from "@langwatch/browser-host/link";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { langwatchEndpoint } from "@langwatch/design-system/langwatch-endpoint-env";
import {
  API_KEY_PLACEHOLDER,
  PersonalAccessTokenBanner,
} from "@langwatch/design-system/personal-access-token-banner";
import { Box, Heading, HStack, Tabs, Tag, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
import { EvaluationExecutionMode } from "@langwatch/workflow-contract";
import { Info } from "react-feather";
import type { UseFormReturn } from "react-hook-form";

import { RenderCode } from "../workflow/code/render-code.tsx";
import type { CheckConfigFormData } from "./check-config-form.tsx";

// Sample values for the fields a Go example can send, in the order the request
// body renders them.
const GO_SAMPLE_FIELD_VALUES: Record<string, string> = {
  input: `"user input"`,
  output: `"generated response"`,
  contexts: `[]string{"retrieved snippet 1", "retrieved snippet 2"}`,
  expected_output: `"gold answer"`,
  conversation: `[]map[string]any{{"input": "hi", "output": "hello"}}`,
};

function buildGoDataBlock(fields: string[]): string {
  const entries = Object.entries(GO_SAMPLE_FIELD_VALUES)
    .filter(([field]) => fields.includes(field))
    .map(([field, value]) => `\t\t\t"${field}": ${value},`);

  if (entries.length === 0) {
    return `map[string]any{}`;
  }

  return `map[string]any{\n${entries.join("\n")}\n\t\t}`;
}

function buildGoResponseHandling(isGuardrail: boolean): string {
  if (!isGuardrail) {
    return `\tout, _ := io.ReadAll(resp.Body)
\tfmt.Println(string(out))`;
  }

  return `\tvar guardrail struct {
\t\tPassed bool \`json:"passed"\`
\t}
\tif err := json.NewDecoder(resp.Body).Decode(&guardrail); err != nil {
\t\tpanic(err)
\t}
\tif !guardrail.Passed {
\t\t// handle the guardrail here
\t\tfmt.Println("I'm sorry, I can't do that.")
\t\treturn
\t}
\t// ... continue with your LLM call`;
}

// The Go tracing SDK has no "run evaluator by slug" helper, so the Go example
// posts the same request the curl tab sends, authenticated with
// `Authorization: Bearer <LANGWATCH_API_KEY>` (never the legacy X-Auth-Token
// header).
export function buildGoEvaluationSnippet({
  name,
  checkSlug,
  fields,
  isGuardrail,
  settingsJson,
}: {
  name: string;
  checkSlug: string | undefined;
  fields: string[];
  isGuardrail: boolean;
  settingsJson: string | null;
}): string {
  // Interpolated, not raw: evaluator settings can carry free text, and a
  // single backtick in it would terminate a Go raw literal and leave the
  // snippet unparseable. JSON's escapes are all valid Go ones, so quoting
  // the settings as a JSON string yields a valid Go interpreted literal.
  const settingsEntry =
    settingsJson === null
      ? ""
      : `\n\t\t"settings": json.RawMessage(${JSON.stringify(settingsJson)}),`;
  const asGuardrailEntry = isGuardrail ? `\n\t\t"as_guardrail": true,` : "";
  const ioImport = isGuardrail ? "" : `\n\t"io"`;

  return `package main

import (
\t"bytes"
\t"context"
\t"encoding/json"
\t"fmt"${ioImport}
\t"net/http"
\t"os"
)

// Uses LANGWATCH_API_KEY environment variable

func main() {
\tctx := context.Background()

\tbody, _ := json.Marshal(map[string]any{
\t\t"name": "${name}",
\t\t"data": ${buildGoDataBlock(fields)},${asGuardrailEntry}${settingsEntry}
\t})

\treq, err := http.NewRequestWithContext(ctx, http.MethodPost,
\t\t"${langwatchEndpoint()}/api/evaluations/${checkSlug}/evaluate",
\t\tbytes.NewReader(body))
\tif err != nil {
\t\tpanic(err)
\t}
\treq.Header.Set("Authorization", "Bearer "+os.Getenv("LANGWATCH_API_KEY"))
\treq.Header.Set("Content-Type", "application/json")

\tresp, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()

${buildGoResponseHandling(isGuardrail)}
}`;
}

function nextStepInstruction({
  isGuardrail,
  isOutputMandatory,
}: {
  isGuardrail: boolean;
  isOutputMandatory: boolean;
}): string {
  if (!isGuardrail) return "Then, pass in the message data to get the result of the evaluator:";
  if (isOutputMandatory) return "Then, after calling your LLM, check for the guardrail:";
  return "Then, either before or after calling your LLM, check for the guardrail:";
}

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
  executionMode: EvaluationExecutionMode | undefined;
  settings: Record<string, unknown>;
  storeSettingsOnCode: boolean;
  checkSlug?: string;
}) {
  const isGuardrail = executionMode === EvaluationExecutionMode.AS_GUARDRAIL;
  const checkSlug = storeSettingsOnCode ? checkType : slug;

  const { project, organization } = useOrganizationTeamProject();
  const isOutputMandatory = evaluatorDefinition.requiredFields.includes("output");
  const minting = useMintPersonalToken({
    organizationId: organization?.id,
    projectId: project?.id,
    userId: useOptionalUiCapabilities()?.session.currentUser()?.id,
    name: "Personal access token",
    permissions: ["evaluations:manage"],
  });
  const token = minting.token ?? null;

  const snippet: SnippetContext = {
    name,
    evaluatorDefinition,
    storeSettingsOnCode,
    settings,
    isGuardrail,
    isOutputMandatory,
    checkSlug,
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
          This {executionMode === EvaluationExecutionMode.MANUALLY ? "evaluator" : "guardrail"}{" "}
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
            )),
          )}
      </HStack>
      <Text fontSize="14px">
        Follow the code example below to integrate this {isGuardrail ? "guardrail" : "evaluator"} in
        your LLM pipeline, save changes first for the {isGuardrail ? "guardrail" : "evaluator"} to
        work.
      </Text>
      {form && (
        <HStack>
          <Checkbox {...form.register("storeSettingsOnCode")}>Store settings on code</Checkbox>
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
          <Tabs.Trigger value="go">Go</Tabs.Trigger>
          <Tabs.Trigger value="curl">Curl</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="python" padding={0}>
          <PythonInstructions async={false} snippet={snippet} />
        </Tabs.Content>
        <Tabs.Content value="python-async" padding={0}>
          <PythonInstructions async={true} snippet={snippet} />
        </Tabs.Content>
        <Tabs.Content value="typescript" padding={0}>
          <TypeScriptInstructions snippet={snippet} />
        </Tabs.Content>
        <Tabs.Content value="go" padding={0}>
          <GoInstructions snippet={snippet} />
        </Tabs.Content>
        <Tabs.Content value="curl" padding={0}>
          <VStack align="start" width="full" gap={3}>
            {project && organization && (
              <PersonalAccessTokenBanner
                token={token}
                isCreating={minting.isMinting}
                scopeNote={minting.scopeNote}
                onCreate={() =>
                  void minting
                    .mint()
                    .catch((error: unknown) =>
                      showErrorToast({
                        error,
                        fallbackTitle: "Couldn't create the personal access token",
                      }),
                    )
                }
              />
            )}
            <Box className="markdown" width="full">
              <RenderCode
                code={`# Set your API key and endpoint URL
API_KEY="${token ?? API_KEY_PLACEHOLDER}"

# Use curl to send the POST request, e.g.:
curl -X POST "${langwatchEndpoint()}/api/evaluations/${checkSlug}/evaluate" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
{
  "trace_id": "trace-123",
  "name": "${name}",
  "data": {
    ${evaluatorDefinition.requiredFields
      .map((field) => `"${field}": "${field} content"`)
      .concat(
        evaluatorDefinition.optionalFields.map(
          (field) => `"${field}": "${field} content (optional)"`,
        ),
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
                  2,
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

type SnippetContext = {
  name: string;
  evaluatorDefinition: (typeof AVAILABLE_EVALUATORS)[keyof typeof AVAILABLE_EVALUATORS];
  storeSettingsOnCode: boolean;
  settings: Record<string, unknown>;
  isGuardrail: boolean;
  isOutputMandatory: boolean;
  checkSlug: string | undefined;
};

const DATA_FIELDS = [
  { field: "input", python: `"input": user_input`, typescript: `input: message` },
  {
    field: "output",
    python: `"output": generated_response`,
    typescript: `output: generatedResponse`,
  },
  {
    field: "contexts",
    python: `"contexts": ["retrieved snippet 1", "retrieved snippet 2"]`,
    typescript: `contexts: ["retrieved snippet 1", "retrieved snippet 2"]`,
  },
  {
    field: "expected_output",
    python: `"expected_output": gold_answer`,
    typescript: `expectedOutput: goldAnswer`,
  },
  {
    field: "conversation",
    python: `"conversation": conversation_history`,
    typescript: `conversation: conversationHistory`,
  },
] as const;

function dataFieldLines(
  evaluatorDefinition: SnippetContext["evaluatorDefinition"],
  language: "python" | "typescript",
): string[] {
  const optionalMark = language === "python" ? "  # optional" : " /* optional */";
  return DATA_FIELDS.flatMap((entry) => {
    if (evaluatorDefinition.requiredFields.includes(entry.field)) return [entry[language]];
    if (evaluatorDefinition.optionalFields.includes(entry.field)) {
      return [entry[language] + optionalMark];
    }
    return [];
  });
}

function PythonInstructions({ async, snippet }: { async: boolean; snippet: SnippetContext }) {
  const {
    name,
    evaluatorDefinition,
    storeSettingsOnCode,
    settings,
    isGuardrail,
    isOutputMandatory,
    checkSlug,
  } = snippet;
  const nameParam = `\n        name="${name}",`;
  const dataFields = dataFieldLines(evaluatorDefinition, "python");

  const dataParam =
    dataFields.length > 0
      ? `\n        data={\n            ${dataFields.join(",\n            ")}\n        },`
      : `\n        data={},`;

  const settingsParams = storeSettingsOnCode
    ? `\n        settings=${JSON.stringify(settings ?? {}, null, 2)
        .replace(/true/g, "True")
        .replace(/false/g, "False")
        .split("\n")
        .map((line, index) => (index === 0 ? line : "        " + line))
        .join("\n")},`
    : "";

  const asGuardrailParam = isGuardrail ? `\n        as_guardrail=True,` : "";

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
          <Text fontSize="14px">{nextStepInstruction({ isGuardrail, isOutputMandatory })}</Text>
          <Box className="markdown" width="full">
            <RenderCode
              code={`def llm_step():
  ... # your existing code

  ${isGuardrail ? "guardrail" : "result"} = ${
    async ? `await langwatch.evaluation.async_evaluate` : `langwatch.evaluation.evaluate`
  }(
      "${checkSlug}",${dataParam}${nameParam}${settingsParams}${asGuardrailParam}
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
}

function TypeScriptInstructions({ snippet }: { snippet: SnippetContext }) {
  const {
    name,
    evaluatorDefinition,
    storeSettingsOnCode,
    settings,
    isGuardrail,
    isOutputMandatory,
    checkSlug,
  } = snippet;
  const nameParam = `\n        name: "${name}",`;
  const dataFields = dataFieldLines(evaluatorDefinition, "typescript");

  const dataParam =
    dataFields.length > 0
      ? `\n        data: {\n          ${dataFields.join(",\n          ")}\n        },`
      : `\n        data: {},`;

  const settingsParams = storeSettingsOnCode
    ? `\n        settings: ${JSON.stringify(settings ?? {}, null, 2)
        // remove quotes on json keys that have only safe characters in it
        .replace(/"(\w+)"\s*:/g, "$1:")
        .split("\n")
        .map((line, index) => (index === 0 ? line : "      " + line))
        .join("\n")},`
    : "";

  const asGuardrailParam = isGuardrail ? `\n        asGuardrail: true,` : "";

  return (
    <VStack align="start" width="full" gap={3}>
      <Text fontSize="14px">
        First, set up your traces and spans capturing as explained in the{" "}
        <Link href="https://docs.langwatch.ai/integration/typescript/guide" isExternal>
          documentation
        </Link>
        .
      </Text>
      {(!isOutputMandatory || !isGuardrail) && (
        <>
          <Text fontSize="14px">{nextStepInstruction({ isGuardrail, isOutputMandatory })}</Text>
          <Box className="markdown" width="full">
            <RenderCode
              code={`import { LangWatch } from "langwatch";

const langwatch = new LangWatch();

async function llmStep({ message }: { message: string }): Promise<string> {
  ${isGuardrail ? "" : "// ... your existing code\n\n    "}// call the ${
    isGuardrail ? "guardrail" : "evaluator"
  }
  const ${isGuardrail ? "guardrail" : "result"} = await langwatch.evaluations.evaluate(
    "${checkSlug}",
    {${dataParam}${nameParam}${settingsParams}${asGuardrailParam}
    }
  );
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
}
}`}
              language="typescript"
            />
          </Box>
        </>
      )}
    </VStack>
  );
}

function GoInstructions({ snippet }: { snippet: SnippetContext }) {
  const {
    name,
    evaluatorDefinition,
    storeSettingsOnCode,
    settings,
    isGuardrail,
    isOutputMandatory,
    checkSlug,
  } = snippet;
  return (
    <VStack align="start" width="full" gap={3}>
      <Text fontSize="14px">
        First, set up your traces and spans capturing as explained in the{" "}
        <Link href="https://github.com/langwatch/langwatch/tree/main/sdks/go" isExternal>
          Go SDK documentation
        </Link>
        .
      </Text>
      {(!isOutputMandatory || !isGuardrail) && (
        <>
          <Text fontSize="14px">{nextStepInstruction({ isGuardrail, isOutputMandatory })}</Text>
          <Box className="markdown" width="full">
            <RenderCode
              code={buildGoEvaluationSnippet({
                name,
                checkSlug,
                fields: [
                  ...evaluatorDefinition.requiredFields,
                  ...evaluatorDefinition.optionalFields,
                ],
                isGuardrail,
                settingsJson: storeSettingsOnCode ? JSON.stringify(settings ?? {}) : null,
              })}
              language="go"
            />
          </Box>
        </>
      )}
    </VStack>
  );
}

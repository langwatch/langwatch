import {
  Box,
  HStack,
  Link,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import {
  langwatchEndpoint,
  langwatchEndpointEnv,
} from "../code/langwatchEndpointEnv";
import { RenderCode } from "../code/RenderCode";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";

export type EvaluatorApiUsageDialogProps = {
  evaluator: Evaluator | null;
  open: boolean;
  onClose: () => void;
};

type UsageMode = "experiment" | "online";
type Language = "python" | "typescript" | "bash";

/**
 * Dialog showing code examples for using an evaluator from the API.
 * Supports both Experiment (batch) and Online Evaluation modes.
 */
export function EvaluatorApiUsageDialog({
  evaluator,
  open,
  onClose,
}: EvaluatorApiUsageDialogProps) {
  const { project } = useOrganizationTeamProject();
  const [usageMode, setUsageMode] = useState<UsageMode>("online");
  const [language, setLanguage] = useState<Language>("python");

  if (!evaluator) return null;

  const evaluatorSlug = evaluator.slug ?? "your-evaluator-slug";
  const evaluatorName = evaluator.name ?? "My Evaluator";

  // Get evaluator definition for field information
  const config = evaluator.config as { evaluatorType?: string } | null;
  const evaluatorType = config?.evaluatorType ?? "";
  const evaluatorDef = evaluatorType
    ? AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes]
    : null;

  // Build data fields for experiment mode (Python)
  const buildPythonExperimentDataFields = (): string => {
    const allFields = [
      ...(evaluatorDef?.requiredFields ?? []),
      ...(evaluatorDef?.optionalFields ?? []),
    ];

    if (allFields.length === 0) {
      return `            "input": row["input"],
            "output": output,`;
    }

    return allFields
      .map((field) => {
        if (field === "output") return `            "${field}": output,`;
        if (field === "input") return `            "${field}": row["input"],`;
        if (field === "contexts")
          return `            "${field}": row["contexts"],`;
        if (field === "expected_output")
          return `            "${field}": row["expected_output"],`;
        if (field === "expected_contexts")
          return `            "${field}": row["expected_contexts"],`;
        if (field === "conversation")
          return `            "${field}": row["conversation"],`;
        return `            "${field}": "",`;
      })
      .join("\n");
  };

  // Build data fields for online mode (Python)
  const buildPythonOnlineDataFields = (): string => {
    const allFields = [
      ...(evaluatorDef?.requiredFields ?? []),
      ...(evaluatorDef?.optionalFields ?? []),
    ];

    if (allFields.length === 0) {
      return `            "input": "",
            "output": "",`;
    }

    return allFields.map((field) => `            "${field}": "",`).join("\n");
  };

  // Build data fields for experiment mode (TypeScript)
  const buildTypeScriptExperimentDataFields = (): string => {
    const allFields = [
      ...(evaluatorDef?.requiredFields ?? []),
      ...(evaluatorDef?.optionalFields ?? []),
    ];

    if (allFields.length === 0) {
      return `        input: item.input,
        output: output,`;
    }

    return allFields
      .map((field) => {
        if (field === "input") return `        input: item.input,`;
        if (field === "output") return `        output: output,`;
        return `        ${field}: item.${field},`;
      })
      .join("\n");
  };

  // Build data fields for online mode (TypeScript)
  const buildTypeScriptOnlineDataFields = (): string => {
    const allFields = [
      ...(evaluatorDef?.requiredFields ?? []),
      ...(evaluatorDef?.optionalFields ?? []),
    ];

    if (allFields.length === 0) {
      return `      input: "", // your input value
      output: "", // your output value`;
    }

    return allFields
      .map((field) => `      ${field}: "", // your ${field} value`)
      .join("\n");
  };

  // Build data fields for cURL
  const buildCurlDataFields = (): string => {
    const allFields = [
      ...(evaluatorDef?.requiredFields ?? []),
      ...(evaluatorDef?.optionalFields ?? []),
    ];

    if (allFields.length === 0) {
      return `"input": "input content",
    "output": "output content"`;
    }

    return allFields.map((field) => `"${field}": "your ${field}"`).join(",\n    ");
  };

  // ============================================================================
  // Experiment Mode Code Snippets
  // ============================================================================

  const experimentPythonCode = `${langwatchEndpointEnv()}import langwatch

df = langwatch.datasets.get_dataset("dataset-id").to_pandas()

experiment = langwatch.experiment.init("my-experiment")

for index, row in experiment.loop(df.iterrows()):
    # your execution code here
    output = your_llm_call(row["input"])

    experiment.evaluate(
        "evaluators/${evaluatorSlug}",
        index=index,
        data={
${buildPythonExperimentDataFields()}
        },
        settings={}
    )`;

  const experimentTypeScriptCode = `${langwatchEndpointEnv()}import { LangWatch } from "langwatch";

const langwatch = new LangWatch();

// Fetch dataset from LangWatch
const dataset = await langwatch.datasets.get("your-dataset-slug");

const experiment = await langwatch.experiments.init("my-experiment");

await experiment.run(
  dataset.entries.map((e) => e.entry),
  async ({ item, index }) => {
    // Run your LLM/agent
    const output = await myLLM(item.input);

    // Evaluate the output
    await experiment.evaluate("evaluators/${evaluatorSlug}", {
      index,
      data: {
${buildTypeScriptExperimentDataFields()}
      },
    });
  },
  { concurrency: 4 }
);`;

  // ============================================================================
  // Online Evaluation Mode Code Snippets
  // ============================================================================

  const onlinePythonCode = `${langwatchEndpointEnv()}import langwatch

@langwatch.span()
def my_llm_step():
    ... # your existing code
    result = langwatch.evaluation.evaluate(
        "evaluators/${evaluatorSlug}",
        name="${evaluatorName}",
        data={
${buildPythonOnlineDataFields()}
        },
        settings={},
    )
    print(result)`;

  const onlineTypeScriptCode = `${langwatchEndpointEnv()}import { LangWatch } from "langwatch";

const langwatch = new LangWatch();

async function myLLMStep(input: string): Promise<string> {
  // ... your existing code

  // Call the evaluator
  const result = await langwatch.evaluations.evaluate("evaluators/${evaluatorSlug}", {
    name: "${evaluatorName}",
    data: {
${buildTypeScriptOnlineDataFields()}
    },
    settings: {},
  });

  console.log(result);
  return result;
}`;

  const curlCode = `# Set your API key
API_KEY="$LANGWATCH_API_KEY"

# Use curl to send the POST request
curl -X POST "${langwatchEndpoint()}/api/evaluations/evaluators/${evaluatorSlug}/evaluate" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
{
  "name": "${evaluatorName}",
  "data": {
    ${buildCurlDataFields()}
  },
  "settings": {}
}
EOF

# Response:
# {
#   "status": "processed",
#   "passed": true,
#   "score": 1,
#   "details": "possible explanation"
# }`;

  const getCode = (): string => {
    if (usageMode === "experiment") {
      switch (language) {
        case "python":
          return experimentPythonCode;
        case "typescript":
          return experimentTypeScriptCode;
        case "bash":
          return curlCode;
        default:
          return experimentPythonCode;
      }
    } else {
      switch (language) {
        case "python":
          return onlinePythonCode;
        case "typescript":
          return onlineTypeScriptCode;
        case "bash":
          return curlCode;
        default:
          return onlinePythonCode;
      }
    }
  };

  const getLanguageForHighlight = (): string => {
    switch (language) {
      case "python":
        return "python";
      case "typescript":
        return "typescript";
      case "bash":
        return "bash";
      default:
        return "python";
    }
  };

  const apiKeyLink = project ? `/${project.slug}/settings` : "/settings";
  const docsLink =
    usageMode === "experiment"
      ? "https://docs.langwatch.ai/evaluations/experiments/overview"
      : "https://docs.langwatch.ai/evaluations/online-evaluation/overview";

  return (
    <DialogRoot
      open={open}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
    >
      <DialogContent maxWidth="800px">
        <DialogHeader>
          <DialogTitle>Use via API</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody paddingBottom={6}>
          <VStack align="stretch" gap={4}>
            {/* Evaluator info */}
            <Box>
              <Text fontSize="sm" color="fg.muted">
                Evaluator: <strong>{evaluator.name}</strong>
                {evaluator.slug && (
                  <Text as="span" color="fg.subtle">
                    {" "}
                    ({evaluator.slug})
                  </Text>
                )}
              </Text>
            </Box>

            {/* Mode and Language Selectors */}
            <HStack gap={4}>
              <NativeSelect.Root width="200px">
                <NativeSelect.Field
                  value={usageMode}
                  onChange={(e) => setUsageMode(e.target.value as UsageMode)}
                  data-testid="usage-mode-select"
                >
                  <option value="online">Online Evaluation</option>
                  <option value="experiment">Experiment (Batch)</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>

              <NativeSelect.Root width="170px">
                <NativeSelect.Field
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  data-testid="language-select"
                >
                  <option value="python">Python</option>
                  <option value="typescript">TypeScript</option>
                  <option value="bash">cURL</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </HStack>

            {/* Code Block */}
            <Box borderRadius="md" overflow="hidden" width="full">
              <RenderCode
                code={getCode()}
                language={getLanguageForHighlight()}
                style={{ padding: "16px", width: "100%" }}
              />
            </Box>

            {/* Help text */}
            <VStack align="start" gap={2}>
              <Text fontSize="sm" color="fg.muted">
                Set the <code>LANGWATCH_API_KEY</code> environment variable with
                your API key.{" "}
                <Link
                  href={apiKeyLink}
                  color="blue.500"
                  display="inline-flex"
                  alignItems="center"
                  gap={1}
                >
                  Find your API key <ExternalLink size={12} />
                </Link>
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Learn more about{" "}
                {usageMode === "experiment"
                  ? "running experiments"
                  : "online evaluations"}{" "}
                in our{" "}
                <Link
                  href={docsLink}
                  color="blue.500"
                  display="inline-flex"
                  alignItems="center"
                  gap={1}
                  target="_blank"
                >
                  documentation <ExternalLink size={12} />
                </Link>
              </Text>
            </VStack>
          </VStack>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
}

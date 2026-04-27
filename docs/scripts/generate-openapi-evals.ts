/**
 * Script to generate openapi-evals.json from AVAILABLE_EVALUATORS
 *
 * Fetches the evaluators.generated.ts from the langwatch/langevals repo
 * and generates the OpenAPI spec with proper code samples.
 *
 * Run with: npx tsx scripts/generate-openapi-evals.ts
 */

const EVALUATORS_URL =
  "https://raw.githubusercontent.com/langwatch/langevals/main/ts-integration/evaluators.generated.ts";

type EvaluatorDefinition = {
  name: string;
  description: string;
  category: string;
  docsUrl?: string;
  isGuardrail: boolean;
  requiredFields: string[];
  optionalFields: string[];
  settings: Record<string, { description?: string; default: unknown }>;
  envVars: string[];
  result: {
    score?: { description: string };
    passed?: { description: string };
    label?: { description: string };
  };
};

type AvailableEvaluators = Record<string, EvaluatorDefinition>;

const toTitleCase = (str: string): string => {
  return str
    .split(/[/_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const generatePythonExperimentSample = (
  slug: string,
  requiredFields: string[],
  optionalFields: string[]
): string => {
  const allFields = [...requiredFields, ...optionalFields];
  const dataFields = allFields
    .map((field) => {
      if (field === "output") return `            "${field}": output,`;
      if (field === "input") return `            "${field}": row["input"],`;
      if (field === "contexts") return `            "${field}": row["contexts"],`;
      if (field === "expected_output")
        return `            "${field}": row["expected_output"],`;
      if (field === "expected_contexts")
        return `            "${field}": row["expected_contexts"],`;
      if (field === "conversation")
        return `            "${field}": row["conversation"],`;
      return `            "${field}": "",`;
    })
    .join("\n");

  return `import langwatch

df = langwatch.datasets.get_dataset("dataset-id").to_pandas()

experiment = langwatch.experiment.init("my-experiment")

for index, row in experiment.loop(df.iterrows()):
    # your execution code here
    experiment.evaluate(
        "${slug}",
        index=index,
        data={
${dataFields}
        },
        settings={}
    )
`;
};

const generatePythonOnlineSample = (
  slug: string,
  name: string,
  requiredFields: string[],
  optionalFields: string[]
): string => {
  const allFields = [...requiredFields, ...optionalFields];
  const dataFields = allFields
    .map((field) => `            "${field}": "",`)
    .join("\n");

  const checkName = toTitleCase(name);

  return `import langwatch

@langwatch.span()
def my_llm_step():
    ... # your existing code
    result = langwatch.evaluation.evaluate(
        "${slug}",
        name="My ${checkName} Check",
        data={
${dataFields}
        },
        settings={},
    )
    print(result)`;
};

const generateTypeScriptExperimentSample = (
  slug: string,
  requiredFields: string[],
  optionalFields: string[]
): string => {
  const allFields = [...requiredFields, ...optionalFields];
  const dataFields = allFields
    .map((field) => {
      if (field === "input") return `        input: item.input,`;
      if (field === "output") return `        output: output,`;
      return `        ${field}: item.${field},`;
    })
    .join("\n");

  return `import { LangWatch } from "langwatch";

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
    await experiment.evaluate("${slug}", {
      index,
      data: {
${dataFields}
      },
    });
  },
  { concurrency: 4 }
);`;
};

const generateTypeScriptOnlineSample = (
  slug: string,
  requiredFields: string[],
  optionalFields: string[]
): string => {
  const allFields = [...requiredFields, ...optionalFields];
  const dataFields = allFields
    .map((field) => `      ${field}: "", // your ${field} value`)
    .join("\n");

  return `import { LangWatch } from "langwatch";

const langwatch = new LangWatch();

async function myLLMStep(input: string): Promise<string> {
  // ... your existing code

  // Call the evaluator
  const result = await langwatch.evaluations.evaluate("${slug}", {
    name: "my-evaluation",
    data: {
${dataFields}
    },
    settings: {},
  });

  console.log(result);
  return result;
}`;
};

const generateSettingsSchema = (
  slug: string,
  settings: Record<string, { description?: string; default: unknown }>
): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(settings)) {
    const prop: Record<string, unknown> = {};

    if (value.description) {
      prop.description = value.description;
    }

    const defaultValue = value.default;

    if (typeof defaultValue === "string") {
      prop.type = "string";
      prop.default = defaultValue;
    } else if (typeof defaultValue === "number") {
      prop.type = "number";
      prop.default = defaultValue;
    } else if (typeof defaultValue === "boolean") {
      prop.type = "boolean";
      prop.default = defaultValue;
    } else if (Array.isArray(defaultValue)) {
      prop.type = "array";
      prop.default = defaultValue;
    } else if (typeof defaultValue === "object" && defaultValue !== null) {
      prop.type = "object";
      prop.default = defaultValue;
    } else {
      prop.type = "string";
    }

    properties[key] = prop;
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
};

const generateRequestSchema = (
  slug: string,
  requiredFields: string[],
  optionalFields: string[]
): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};

  const fieldDescriptions: Record<string, string> = {
    input: "The input text to evaluate",
    output: "The output/response text to evaluate",
    contexts: "Array of context strings used for RAG evaluation",
    expected_output: "The expected output for comparison",
    expected_contexts: "The expected contexts for comparison",
    conversation: "Array of conversation turns for multi-turn evaluation",
  };

  for (const field of [...requiredFields, ...optionalFields]) {
    if (field === "contexts" || field === "expected_contexts") {
      properties[field] = {
        type: "array",
        items: { type: "string" },
        description: fieldDescriptions[field],
      };
    } else if (field === "conversation") {
      properties[field] = {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: { type: "string" },
            content: { type: "string" },
          },
        },
        description: fieldDescriptions[field],
      };
    } else {
      properties[field] = {
        type: "string",
        description: fieldDescriptions[field],
      };
    }
  }

  return {
    type: "object",
    properties: {
      trace_id: {
        type: "string",
        description: "Optional trace ID to associate this evaluation with a trace",
      },
      data: {
        type: "object",
        properties,
        required: requiredFields,
      },
    },
    required: ["data"],
  };
};

const slugToSchemaName = (slug: string): string => {
  return slug.replace(/\//g, "_");
};

const slugToPathName = (slug: string): string => {
  return slug.replace(/\//g, "_");
};

const generateOpenAPISpec = async (): Promise<void> => {
  console.log(`Fetching evaluators from ${EVALUATORS_URL}...`);

  const response = await fetch(EVALUATORS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch evaluators: ${response.statusText}`);
  }

  const content = await response.text();

  // Extract the AVAILABLE_EVALUATORS object using regex
  // Find the start of the object
  const startMatch = content.match(
    /export const AVAILABLE_EVALUATORS[^=]*=\s*\{/
  );
  if (!startMatch || startMatch.index === undefined) {
    throw new Error("Could not find AVAILABLE_EVALUATORS in the file");
  }

  // Find the matching closing brace by counting braces
  let braceCount = 0;
  let startIndex = startMatch.index + startMatch[0].length - 1; // Position of opening brace
  let endIndex = startIndex;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (!inString && (char === '"' || char === "'" || char === "`")) {
      inString = true;
      stringChar = char;
      continue;
    }

    if (inString && char === stringChar) {
      inString = false;
      continue;
    }

    if (!inString) {
      if (char === "{") braceCount++;
      if (char === "}") braceCount--;

      if (braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  const objectStr = content.slice(startIndex, endIndex);

  // Convert the TypeScript object literal to JSON-compatible format
  // This is a simplified conversion - we'll evaluate it in a safer way
  let jsonStr = objectStr
    // Remove template literal backticks and convert to regular strings
    .replace(/`([^`]*)`/g, (_, p1) => JSON.stringify(p1.trim()))
    // Convert property names without quotes to quoted
    .replace(/(\s)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    // Handle trailing commas (remove them)
    .replace(/,(\s*[}\]])/g, "$1");

  // Parse the JSON
  let evaluators: AvailableEvaluators;
  try {
    evaluators = JSON.parse(jsonStr);
  } catch (e) {
    // If direct parsing fails, try a different approach - evaluate as JS
    console.log(
      "Direct JSON parsing failed, trying alternative parsing method..."
    );

    // Use Function constructor to safely evaluate the object
    // First, we need to extract just the object without the export statement
    const evalStr = `return ${objectStr}`;
    try {
      const fn = new Function(evalStr);
      evaluators = fn();
    } catch (e2) {
      console.error("Failed to parse AVAILABLE_EVALUATORS:", e2);
      throw new Error("Could not parse AVAILABLE_EVALUATORS object");
    }
  }

  console.log(`Found ${Object.keys(evaluators).length} evaluators`);

  // Generate OpenAPI spec
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {
    EvaluationResult: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["processed", "skipped", "error"],
        },
        score: {
          type: "number",
          description: "Numeric score from the evaluation",
        },
        passed: {
          type: "boolean",
          description: "Whether the evaluation passed",
        },
        label: {
          type: "string",
          description: "Label assigned by the evaluation",
        },
        details: {
          type: "string",
          description: "Additional details about the evaluation",
        },
        cost: {
          type: "object",
          properties: {
            currency: { type: "string" },
            amount: { type: "number" },
          },
        },
      },
    },
  };

  for (const [slug, evaluator] of Object.entries(evaluators)) {
    const schemaName = slugToSchemaName(slug);
    const pathName = slugToPathName(slug);

    // Generate request schema
    schemas[`${schemaName}Request`] = generateRequestSchema(
      slug,
      evaluator.requiredFields,
      evaluator.optionalFields
    );

    // Generate settings schema
    schemas[`${schemaName}Settings`] = generateSettingsSchema(
      slug,
      evaluator.settings
    );

    // Generate path
    paths[`/${slug}/evaluate`] = {
      post: {
        summary: evaluator.name,
        description: evaluator.description.trim(),
        operationId: `${schemaName}_evaluate`,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { $ref: `#/components/schemas/${schemaName}Request` },
                  {
                    type: "object",
                    properties: {
                      settings: {
                        $ref: `#/components/schemas/${schemaName}Settings`,
                      },
                    },
                  },
                ],
              },
            },
          },
          required: true,
        },
        responses: {
          "200": {
            description: "Successful evaluation",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/EvaluationResult" },
                },
              },
            },
          },
          "400": {
            description: "Bad request",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { detail: { type: "string" } },
                },
              },
            },
          },
          "500": {
            description: "Internal server error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { detail: { type: "string" } },
                },
              },
            },
          },
        },
        "x-codeSamples": [
          {
            lang: "python",
            label: "Experiment",
            source: generatePythonExperimentSample(
              slug,
              evaluator.requiredFields,
              evaluator.optionalFields
            ),
          },
          {
            lang: "python",
            label: "Online Evaluation",
            source: generatePythonOnlineSample(
              slug,
              evaluator.name,
              evaluator.requiredFields,
              evaluator.optionalFields
            ),
          },
          {
            lang: "typescript",
            label: "Experiment",
            source: generateTypeScriptExperimentSample(
              slug,
              evaluator.requiredFields,
              evaluator.optionalFields
            ),
          },
          {
            lang: "typescript",
            label: "Online Evaluation",
            source: generateTypeScriptOnlineSample(
              slug,
              evaluator.requiredFields,
              evaluator.optionalFields
            ),
          },
        ],
      },
    };
  }

  const openApiSpec = {
    openapi: "3.1.0",
    info: {
      title: "LangEvals API",
      version: "1.0.0",
      description: "API for LangEvals evaluators",
    },
    servers: [
      {
        url: "https://app.langwatch.ai/api/evaluations",
        description: "Production server",
      },
    ],
    security: [{ api_key: [] }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        api_key: {
          type: "apiKey",
          in: "header",
          name: "X-Auth-Token",
          description: "API key for authentication",
        },
      },
    },
  };

  // Write to file
  const outputPath = new URL(
    "../api-reference/openapi-evals.json",
    import.meta.url
  );
  const fs = await import("fs");
  fs.writeFileSync(outputPath, JSON.stringify(openApiSpec, null, 2));

  console.log(`Generated openapi-evals.json with ${Object.keys(paths).length} endpoints`);
};

generateOpenAPISpec().catch(console.error);

/**
 * Pure generator for the "Run via API" snippets.
 *
 * One source of truth for both surfaces (the optimization-studio workflow
 * results panel and the evaluations-v3 workbench). Given a target (workflow or
 * experiment), a data source, and a language, it returns ready-to-run code that
 * triggers an evaluation through the unified evaluations-v3 backend AND reads
 * the per-row results back.
 *
 * The snippets mirror the just-shipped SDK public APIs exactly:
 *   - python: langwatch.experiment.run(...) / langwatch.workflow.run(...)
 *   - typescript: langwatch.experiments.runWithResults(...) /
 *     langwatch.workflows.run(...)
 *   - shell: curl POST to start, then poll + GET results
 */
import {
  buildEvaluateParameters,
  exampleParameterValue,
  IMAGE_EXAMPLE,
  PLACEHOLDER_PARAMETERS,
} from "~/optimization_studio/utils/evaluateApiSnippet";
import type { WorkflowField } from "~/optimization_studio/utils/workflowFields";

export type RunSnippetLang = "python" | "typescript" | "shell";
export type RunSnippetDataSource = "attached" | "inline" | "dataset_id";
export type RunSnippetKind = "workflow" | "experiment";

export interface BuildRunSnippetInput {
  /** Whether the snippet runs a studio workflow or an evaluations-v3 experiment. */
  kind: RunSnippetKind;
  /** The workflow id (kind "workflow") or the experiment slug (kind "experiment"). */
  identifier: string;
  /** Origin used in the curl example, e.g. "https://app.langwatch.ai". */
  baseUrl: string;
  /** Entry point fields, used to build the inline / parameters example. */
  entryFields: WorkflowField[];
  /** Columns the attached dataset provides, omitted from the inline example. */
  datasetColumns: string[];
  /** Human-readable dataset name, surfaced in comments when available. */
  datasetName?: string;
  /** Which data source the snippet demonstrates. */
  dataSource: RunSnippetDataSource;
  /** Project slug, used when constructing example dataset ids. */
  projectSlug?: string;
}

/** Placeholder a reader replaces with a real platform dataset id. */
const DATASET_ID_PLACEHOLDER = "dataset_xxxxxxxxxxxx";

/**
 * Build a single example row for inline-data snippets: every entry field the
 * dataset does not already provide, mapped to an example value of its type.
 * Image fields get a base64 data-url example. When the dataset covers every
 * field we still emit one illustrative field so the shape is obvious.
 */
function buildInlineExampleRow(
  entryFields: WorkflowField[],
  datasetColumns: string[],
): Record<string, string | number | boolean> {
  const datasetColumnSet = new Set(datasetColumns);
  const row: Record<string, string | number | boolean> = {};
  for (const field of entryFields) {
    if (datasetColumnSet.has(field.identifier)) continue;
    const value = exampleParameterValue(field.type);
    if (value === undefined) continue;
    row[field.identifier] = value;
  }
  if (Object.keys(row).length === 0) {
    return { input: "What is the capital of France?" };
  }
  return row;
}

/**
 * The constant "parameters" example: entry fields the dataset does not provide,
 * falling back to an illustrative feature flag when the dataset covers them all.
 */
function buildParametersExample(
  entryFields: WorkflowField[],
  datasetColumns: string[],
): Record<string, string | number | boolean> {
  const mapped = buildEvaluateParameters({ entryFields, datasetColumns });
  return Object.keys(mapped).length > 0 ? mapped : PLACEHOLDER_PARAMETERS;
}

/** Render a JS/TS object literal from an example record. */
function toJsObjectLiteral(
  record: Record<string, string | number | boolean>,
): string {
  const entries = Object.entries(record).map(
    ([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  return `{ ${entries.join(", ")} }`;
}

/** Render a python dict literal from an example record. */
function toPyDictLiteral(
  record: Record<string, string | number | boolean>,
): string {
  const entries = Object.entries(record).map(
    ([key, value]) =>
      `${JSON.stringify(key)}: ${
        typeof value === "boolean"
          ? value
            ? "True"
            : "False"
          : JSON.stringify(value)
      }`,
  );
  return `{${entries.join(", ")}}`;
}

/** The data-source argument for the python / typescript SDK calls. */
function sdkDataSourceArg({
  lang,
  dataSource,
  parametersExample,
  inlineRow,
}: {
  lang: "python" | "typescript";
  dataSource: RunSnippetDataSource;
  parametersExample: Record<string, string | number | boolean>;
  inlineRow: Record<string, string | number | boolean>;
}): string {
  if (lang === "python") {
    if (dataSource === "inline") {
      return `data=[${toPyDictLiteral(inlineRow)}]`;
    }
    if (dataSource === "dataset_id") {
      return `dataset_id="${DATASET_ID_PLACEHOLDER}"`;
    }
    return `parameters=${toPyDictLiteral(parametersExample)}`;
  }

  if (dataSource === "inline") {
    return `data: [${toJsObjectLiteral(inlineRow)}]`;
  }
  if (dataSource === "dataset_id") {
    return `datasetId: "${DATASET_ID_PLACEHOLDER}"`;
  }
  return `parameters: ${toJsObjectLiteral(parametersExample)}`;
}

/** A short comment describing what the chosen data source evaluates. */
function dataSourceComment({
  dataSource,
  datasetName,
  commentPrefix,
}: {
  dataSource: RunSnippetDataSource;
  datasetName?: string;
  commentPrefix: string;
}): string {
  if (dataSource === "inline") {
    return `${commentPrefix} Evaluate the rows you pass inline below.`;
  }
  if (dataSource === "dataset_id") {
    return `${commentPrefix} Evaluate a platform dataset by id.`;
  }
  const named = datasetName ? ` ("${datasetName}")` : "";
  return `${commentPrefix} Evaluate the attached dataset${named}; parameters set constant inputs the dataset does not provide.`;
}

function buildPythonSnippet(input: BuildRunSnippetInput): string {
  const { kind, identifier, dataSource, datasetName } = input;
  const parametersExample = buildParametersExample(
    input.entryFields,
    input.datasetColumns,
  );
  const inlineRow = buildInlineExampleRow(
    input.entryFields,
    input.datasetColumns,
  );
  const arg = sdkDataSourceArg({
    lang: "python",
    dataSource,
    parametersExample,
    inlineRow,
  });
  const call =
    kind === "experiment"
      ? `langwatch.experiment.run("${identifier}", ${arg})`
      : `langwatch.workflow.run("${identifier}", ${arg})`;
  const comment = dataSourceComment({
    dataSource,
    datasetName,
    commentPrefix: "#",
  });

  return `import langwatch

langwatch.setup()  # reads LANGWATCH_API_KEY from the environment

${comment}
result = ${call}

# Read the results back
result.print_summary()      # CI-friendly summary; exits 1 on failures
df = result.results         # per-row results as a pandas DataFrame
print(df.head())
print(result.run_url)       # open the run in LangWatch`;
}

function buildTypescriptSnippet(input: BuildRunSnippetInput): string {
  const { kind, identifier, dataSource, datasetName } = input;
  const parametersExample = buildParametersExample(
    input.entryFields,
    input.datasetColumns,
  );
  const inlineRow = buildInlineExampleRow(
    input.entryFields,
    input.datasetColumns,
  );
  const arg = sdkDataSourceArg({
    lang: "typescript",
    dataSource,
    parametersExample,
    inlineRow,
  });
  const call =
    kind === "experiment"
      ? `await langwatch.experiments.runWithResults("${identifier}", {\n    ${arg},\n  })`
      : `await langwatch.workflows.run("${identifier}", {\n    ${arg},\n  })`;
  const comment = dataSourceComment({
    dataSource,
    datasetName,
    commentPrefix: "  //",
  });

  return `import { LangWatch } from "langwatch";

const langwatch = new LangWatch(); // reads LANGWATCH_API_KEY from the environment

async function main() {
${comment}
  const res = ${call};

  // Read the results back
  console.table(res.rows); // per-row results
  console.log(res.runUrl); // open the run in LangWatch
}

void main();`;
}

function buildShellSnippet(input: BuildRunSnippetInput): string {
  const { kind, identifier, baseUrl, dataSource, datasetName } = input;
  const parametersExample = buildParametersExample(
    input.entryFields,
    input.datasetColumns,
  );
  const inlineRow = buildInlineExampleRow(
    input.entryFields,
    input.datasetColumns,
  );

  const startUrl =
    kind === "experiment"
      ? `${baseUrl}/api/experiments/${identifier}/run`
      : `${baseUrl}/api/workflows/${identifier}/evaluate`;

  let body: Record<string, unknown>;
  if (dataSource === "inline") {
    body = { data: [inlineRow] };
  } else if (dataSource === "dataset_id") {
    body = { dataset_id: DATASET_ID_PLACEHOLDER };
  } else {
    body = { parameters: parametersExample };
  }

  // Pretty JSON re-indented two spaces so the body sits under `-d '`.
  const bodyJson = JSON.stringify(body, null, 2).replace(/\n/g, "\n  ");

  const comment = dataSourceComment({
    dataSource,
    datasetName,
    commentPrefix: "#",
  });

  return `${comment}
# 1. Start the run
RUN=$(curl -s -X POST "${startUrl}" \\
  -H "X-Auth-Token: \${LANGWATCH_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '${bodyJson}')
RUN_ID=$(echo "$RUN" | jq -r '.runId // .run_id')
echo "Started run: $RUN_ID"

# 2. Poll until it finishes (completed | failed | stopped)
while true; do
  STATUS=$(curl -s "${baseUrl}/api/experiments/runs/$RUN_ID" \\
    -H "X-Auth-Token: \${LANGWATCH_API_KEY}" | jq -r '.status')
  echo "status: $STATUS"
  case "$STATUS" in completed|failed|stopped) break;; esac
  sleep 2
done

# 3. Fetch the per-row results
curl -s "${baseUrl}/api/experiments/runs/$RUN_ID/results" \\
  -H "X-Auth-Token: \${LANGWATCH_API_KEY}" | jq

# Alternative: stream live progress instead of polling by listening to the
# Server-Sent Events stream at GET /api/experiments/runs/$RUN_ID/events.`;
}

/**
 * Build the Run via API snippet for one (language x data source) combination.
 */
export function buildRunSnippet(
  input: BuildRunSnippetInput,
  lang: RunSnippetLang,
): string {
  if (lang === "python") return buildPythonSnippet(input);
  if (lang === "typescript") return buildTypescriptSnippet(input);
  return buildShellSnippet(input);
}

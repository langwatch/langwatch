import type { WorkflowField } from "@langwatch/workflow-contract";

import { IMAGE_EXAMPLE, exampleParameterValue } from "./evaluate-api-example.ts";

export { IMAGE_EXAMPLE, exampleParameterValue };

/**
 * Build the example "parameters" object: entry fields the dataset doesn't
 * already provide, each with an example value (non-scalar fields skipped,
 * see `exampleParameterValue`). Fields matching a dataset column are omitted.
 */
export function buildEvaluateParameters({
  entryFields,
  datasetColumns,
}: {
  entryFields: WorkflowField[];
  datasetColumns: string[];
}): Record<string, string | number | boolean> {
  const datasetColumnSet = new Set(datasetColumns);
  const parameters: Record<string, string | number | boolean> = {};
  for (const field of entryFields) {
    if (datasetColumnSet.has(field.identifier)) continue;
    const value = exampleParameterValue(field.type);
    if (value === undefined) continue;
    parameters[field.identifier] = value;
  }
  return parameters;
}

/**
 * Shown when the dataset already provides every entry field - there is nothing
 * workflow-specific to suggest, so a generic feature flag stands in.
 */
export const PLACEHOLDER_PARAMETERS: Record<string, string> = {
  feature_flag: "variant-b",
};

/**
 * The curl snippet for triggering this workflow's evaluation from the REST
 * API, with a "parameters" example derived from the entry point's own fields.
 */
export function evaluateCurlSnippet({
  workflowId,
  baseUrl,
  entryFields,
  datasetColumns,
  datasetName,
}: {
  workflowId: string;
  baseUrl: string;
  entryFields: WorkflowField[];
  datasetColumns: string[];
  datasetName?: string;
}): string {
  const mapped = buildEvaluateParameters({ entryFields, datasetColumns });
  const parameters = Object.keys(mapped).length > 0 ? mapped : PLACEHOLDER_PARAMETERS;

  // Pretty JSON re-indented two spaces so the body sits under `-d '`.
  const bodyJson = JSON.stringify({ parameters }, null, 2).replace(/\n/g, "\n  ");

  const hasDataset = !!datasetName || datasetColumns.length > 0;
  const attachedDatasetLine = datasetName
    ? `# Evaluates the latest committed version against this workflow's\n# attached dataset ("${datasetName}").`
    : `# Evaluates the latest committed version against this workflow's\n# attached dataset.`;
  const datasetLine = hasDataset
    ? attachedDatasetLine
    : `# Evaluates the latest committed version. With no dataset attached, the\n# parameters below form the single evaluated row.`;

  return `${datasetLine}
curl -X POST "${baseUrl}/api/workflows/${workflowId}/evaluate" \\
  -H "X-Auth-Token: \${LANGWATCH_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '${bodyJson}'

# => { "run_id": "run_...", "workflow_version_id": "..." }
#
# "parameters" are constant entry inputs applied to every dataset row (e.g. a
# feature flag or PR number). The dataset feeds the fields it has a column for,
# so set parameters only for inputs the dataset does not provide; naming a
# dataset column here overrides it for every row.
#
# Optional body fields: "version_id" (defaults to the latest commit) and
# "evaluate_on" ("full" | "test" | "train", defaults to "full").`;
}

import type { WorkflowField } from "./workflowFields";

/**
 * A base64 data-URL example for image inputs. Truncated for readability: it
 * shows the "data:<mime>;base64,<payload>" structure the endpoint expects,
 * not a usable image. Callers replace it with their own encoded image.
 */
export const IMAGE_EXAMPLE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...";

/**
 * Example scalar value for an entry field type, or undefined when the type is
 * not a scalar. The evaluate endpoint only accepts string, number or boolean
 * parameter values, so structured inputs (lists, dicts, json schemas, chat
 * messages) come from the dataset and are not offered as constant parameters.
 */
export function exampleParameterValue(
  type: string,
): string | number | boolean | undefined {
  switch (type) {
    case "str":
      return "example";
    case "image":
      return IMAGE_EXAMPLE;
    case "float":
      return 0.5;
    case "int":
      return 42;
    case "bool":
      return true;
    default:
      return undefined;
  }
}

/**
 * Build the example "parameters" object: the entry fields the dataset does not
 * already provide, each with an example value of its type. Fields that match a
 * dataset column by name are omitted - the dataset feeds those per row, and
 * naming one as a parameter would override every row with a single constant.
 * Non-scalar fields are skipped (see exampleParameterValue).
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
  const parameters =
    Object.keys(mapped).length > 0 ? mapped : PLACEHOLDER_PARAMETERS;

  // Pretty JSON re-indented two spaces so the body sits under `-d '`.
  const bodyJson = JSON.stringify({ parameters }, null, 2).replace(
    /\n/g,
    "\n  ",
  );

  const hasDataset = !!datasetName || datasetColumns.length > 0;
  const datasetLine = !hasDataset
    ? `# Evaluates the latest committed version. With no dataset attached, the\n# parameters below form the single evaluated row.`
    : datasetName
      ? `# Evaluates the latest committed version against this workflow's\n# attached dataset ("${datasetName}").`
      : `# Evaluates the latest committed version against this workflow's\n# attached dataset.`;

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

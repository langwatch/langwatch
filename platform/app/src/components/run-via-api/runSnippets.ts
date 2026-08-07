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
 *   - go: net/http POST to start, then poll + GET results
 *   - shell: curl POST to start, then poll + GET results
 *
 * Go has no evaluations entry point on the SDK yet (the Go SDK is tracing only),
 * so its snippet drives the REST API directly, the same three calls the shell
 * snippet makes.
 */
import {
  buildEvaluateParameters,
  exampleParameterValue,
  PLACEHOLDER_PARAMETERS,
} from "~/optimization_studio/utils/evaluateApiSnippet";
import type { WorkflowField } from "~/optimization_studio/utils/workflowFields";

export type RunSnippetLang = "python" | "typescript" | "go" | "shell";
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
  /**
   * Project slug. Reserved for per-project example dataset ids; the current
   * snippets use a fixed placeholder, so it is not read yet.
   */
  projectSlug?: string;
  /** Language the snippet is generated for. */
  lang: RunSnippetLang;
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

/** Path of the endpoint that starts a run, relative to the app origin. */
function runStartPath({ kind, identifier }: BuildRunSnippetInput): string {
  return kind === "experiment"
    ? `/api/experiments/${identifier}/run`
    : `/api/workflows/${identifier}/evaluate`;
}

/**
 * Render the entries of a Go `map[string]any` literal, one `"key": value,` per
 * line at the given indent. Values are pre-aligned the way gofmt aligns a
 * composite literal, so the snippet reads as already-formatted Go.
 */
function toGoMapEntries({
  record,
  indent,
}: {
  record: Record<string, string | number | boolean>;
  indent: string;
}): string {
  const entries = Object.entries(record).map(
    ([key, value]) =>
      [`${JSON.stringify(key)}:`, JSON.stringify(value)] as const,
  );
  const width = Math.max(...entries.map(([key]) => key.length));
  return entries
    .map(([key, value]) => `${indent}${key.padEnd(width)} ${value},`)
    .join("\n");
}

/** The body literal passed to json.Marshal, varying by data source. */
function goRequestBody({
  dataSource,
  parametersExample,
  inlineRow,
}: {
  dataSource: RunSnippetDataSource;
  parametersExample: Record<string, string | number | boolean>;
  inlineRow: Record<string, string | number | boolean>;
}): string {
  const indent = "\t\t\t";
  if (dataSource === "inline") {
    const rows = toGoMapEntries({ record: inlineRow, indent });
    return `\t\t"data": []map[string]any{{\n${rows}\n\t\t}},`;
  }
  if (dataSource === "dataset_id") {
    return `\t\t"dataset_id": ${JSON.stringify(DATASET_ID_PLACEHOLDER)},`;
  }
  const parameters = toGoMapEntries({ record: parametersExample, indent });
  return `\t\t"parameters": map[string]any{\n${parameters}\n\t\t},`;
}

/**
 * The Go snippet: start the run, poll it to a terminal status, then read the
 * per-row results back. Authenticated with `Authorization: Bearer`, never the
 * legacy X-Auth-Token header. The body is marshalled from a map literal rather
 * than pasted in as a raw string, so a field identifier can never break out of
 * the generated source.
 */
function buildGoSnippet(input: BuildRunSnippetInput): string {
  const { baseUrl, dataSource, datasetName } = input;
  const parametersExample = buildParametersExample(
    input.entryFields,
    input.datasetColumns,
  );
  const inlineRow = buildInlineExampleRow(
    input.entryFields,
    input.datasetColumns,
  );
  const comment = dataSourceComment({
    dataSource,
    datasetName,
    commentPrefix: "\t//",
  });
  const body = goRequestBody({ dataSource, parametersExample, inlineRow });

  return `package main

import (
\t"bytes"
\t"context"
\t"encoding/json"
\t"errors"
\t"fmt"
\t"io"
\t"log"
\t"net/http"
\t"os"
\t"time"
)

const (
\tbaseURL     = ${JSON.stringify(baseUrl)}
\tstartPath   = ${JSON.stringify(runStartPath(input))}
\tmaxAttempts = 1800
\tpollEvery   = 2 * time.Second
)

// The statuses that end a run; on anything else it is still going.
var terminalStatuses = map[string]bool{
\t"completed":   true,
\t"failed":      true,
\t"stopped":     true,
\t"interrupted": true,
}

func main() {
\tctx := context.Background()

${comment}
\tbody, err := json.Marshal(map[string]any{
${body}
\t})
\tif err != nil {
\t\tlog.Fatal(err)
\t}

\trunID, err := startRun(ctx, body)
\tif err != nil {
\t\tlog.Fatal(err)
\t}
\tfmt.Println("Started run:", runID)

\tif err := waitForRun(ctx, runID); err != nil {
\t\tlog.Fatal(err)
\t}

\t// Read the results back
\tresults, err := fetchResults(ctx, runID)
\tif err != nil {
\t\tlog.Fatal(err)
\t}
\tfmt.Println(string(results)) // per-row results
}

// call issues an authenticated request. LANGWATCH_API_KEY travels as a bearer
// token, the same key the Python and TypeScript SDKs read from the environment.
func call(ctx context.Context, method, url string, body []byte) (int, []byte, error) {
\tvar reader io.Reader
\tif body != nil {
\t\treader = bytes.NewReader(body)
\t}
\treq, err := http.NewRequestWithContext(ctx, method, url, reader)
\tif err != nil {
\t\treturn 0, nil, err
\t}
\treq.Header.Set("Authorization", "Bearer "+os.Getenv("LANGWATCH_API_KEY"))
\tif body != nil {
\t\treq.Header.Set("Content-Type", "application/json")
\t}

\tresp, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\treturn 0, nil, err
\t}
\tdefer resp.Body.Close()

\tout, err := io.ReadAll(resp.Body)
\tif err != nil {
\t\treturn resp.StatusCode, nil, err
\t}
\treturn resp.StatusCode, out, nil
}

// 1. Start the run.
func startRun(ctx context.Context, body []byte) (string, error) {
\tcode, out, err := call(ctx, http.MethodPost, baseURL+startPath, body)
\tif err != nil {
\t\treturn "", err
\t}
\tif code != http.StatusOK {
\t\treturn "", fmt.Errorf("could not start the run (HTTP %d): %s", code, out)
\t}

\t// The experiment endpoint answers runId, the workflow endpoint run_id.
\tvar started struct {
\t\tRunID       string \`json:"runId"\`
\t\tLegacyRunID string \`json:"run_id"\`
\t}
\tif err := json.Unmarshal(out, &started); err != nil {
\t\treturn "", err
\t}
\tif started.RunID != "" {
\t\treturn started.RunID, nil
\t}
\tif started.LegacyRunID != "" {
\t\treturn started.LegacyRunID, nil
\t}
\treturn "", errors.New("the run was accepted but no run id came back")
}

// 2. Poll until it finishes. Branch on the HTTP status, not the body: a
// non-200 response (404, an auth failure, a 5xx) carries no status field, so
// matching the body alone spins for the full hour instead of failing fast.
func waitForRun(ctx context.Context, runID string) error {
\turl := baseURL + "/api/experiments/runs/" + runID
\tfor attempt := 0; attempt < maxAttempts; attempt++ {
\t\tcode, out, err := call(ctx, http.MethodGet, url, nil)
\t\tif err != nil {
\t\t\treturn err
\t\t}
\t\tif code == http.StatusNotFound {
\t\t\treturn fmt.Errorf("run %s not found (expired, or never recorded); giving up", runID)
\t\t}
\t\tif code != http.StatusOK {
\t\t\treturn fmt.Errorf("could not read run %s (HTTP %d); giving up", runID, code)
\t\t}

\t\tvar run struct {
\t\t\tStatus string \`json:"status"\`
\t\t}
\t\tif err := json.Unmarshal(out, &run); err != nil {
\t\t\treturn err
\t\t}
\t\tfmt.Println("status:", run.Status)
\t\tif terminalStatuses[run.Status] {
\t\t\treturn nil
\t\t}

\t\tselect {
\t\tcase <-ctx.Done():
\t\t\treturn ctx.Err()
\t\tcase <-time.After(pollEvery):
\t\t}
\t}
\treturn fmt.Errorf("gave up waiting for %s after %d polls", runID, maxAttempts)
}

// 3. Fetch the per-row results.
func fetchResults(ctx context.Context, runID string) ([]byte, error) {
\tcode, out, err := call(ctx, http.MethodGet, baseURL+"/api/experiments/runs/"+runID+"/results", nil)
\tif err != nil {
\t\treturn nil, err
\t}
\tif code != http.StatusOK {
\t\treturn nil, fmt.Errorf("could not read the results of %s (HTTP %d): %s", runID, code, out)
\t}
\treturn out, nil
}`;
}

function buildShellSnippet(input: BuildRunSnippetInput): string {
  const { baseUrl, dataSource, datasetName } = input;
  const parametersExample = buildParametersExample(
    input.entryFields,
    input.datasetColumns,
  );
  const inlineRow = buildInlineExampleRow(
    input.entryFields,
    input.datasetColumns,
  );

  const startUrl = `${baseUrl}${runStartPath(input)}`;

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

# 2. Poll until it finishes (completed | failed | stopped | interrupted).
#    Branch on the HTTP status, not the body: a non-200 response (404, an
#    auth failure, a 5xx) carries no .status, so matching the body alone
#    spins on it for the full hour instead of failing fast.
ATTEMPTS=0
MAX_ATTEMPTS=1800
while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  RESPONSE=$(curl -s -w '\\n%{http_code}' "${baseUrl}/api/experiments/runs/$RUN_ID" \\
    -H "X-Auth-Token: \${LANGWATCH_API_KEY}")
  CODE=$(printf '%s' "$RESPONSE" | tail -n1)
  if [ "$CODE" = "404" ]; then
    echo "run $RUN_ID not found (expired, or never recorded); giving up"
    exit 1
  fi
  if [ "$CODE" != "200" ]; then
    echo "could not read run $RUN_ID (HTTP $CODE); giving up"
    exit 1
  fi
  STATUS=$(printf '%s' "$RESPONSE" | sed '$d' | jq -r '.status')
  echo "status: $STATUS"
  case "$STATUS" in completed|failed|stopped|interrupted) break;; esac
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 2
done

if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
  echo "gave up waiting for $RUN_ID after $MAX_ATTEMPTS polls"
  exit 1
fi

# 3. Fetch the per-row results
curl -s "${baseUrl}/api/experiments/runs/$RUN_ID/results" \\
  -H "X-Auth-Token: \${LANGWATCH_API_KEY}" | jq`;
}

/**
 * Build the Run via API snippet for one (language x data source) combination.
 */
export function buildRunSnippet(input: BuildRunSnippetInput): string {
  if (input.lang === "python") return buildPythonSnippet(input);
  if (input.lang === "typescript") return buildTypescriptSnippet(input);
  if (input.lang === "go") return buildGoSnippet(input);
  return buildShellSnippet(input);
}

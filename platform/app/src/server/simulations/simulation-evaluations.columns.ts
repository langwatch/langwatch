import {
  SCENARIO_EVALUATION_STATUSES,
  type ScenarioEvaluationResult,
  type ScenarioEvaluationStatus,
} from "~/server/scenarios/schemas/event-schemas";

/**
 * The `Evaluations.*` parallel arrays of a `simulation_runs` row, one entry
 * per evaluator. Booleans travel as 0/1 and absent values as NULL or '',
 * which is how ClickHouse stores them.
 */
export interface ClickHouseEvaluationColumns {
  "Evaluations.EvaluatorId": string[];
  "Evaluations.Name": string[];
  "Evaluations.Status": string[];
  "Evaluations.Required": number[];
  "Evaluations.Passed": (number | null)[];
  "Evaluations.Score": (number | null)[];
  "Evaluations.Label": string[];
  "Evaluations.Details": string[];
  "Evaluations.CostAmount": (number | null)[];
  "Evaluations.CostCurrency": string[];
  "Evaluations.InputsJson": string[];
}

/** The columns as a SELECT fragment, in the order the record interface lists them. */
export const EVALUATION_COLUMNS_SQL = `
  \`Evaluations.EvaluatorId\`, \`Evaluations.Name\`, \`Evaluations.Status\`,
  \`Evaluations.Required\`, \`Evaluations.Passed\`, \`Evaluations.Score\`,
  \`Evaluations.Label\`, \`Evaluations.Details\`,
  \`Evaluations.CostAmount\`, \`Evaluations.CostCurrency\`,
  \`Evaluations.InputsJson\``;

/**
 * The columns a list read selects: everything but the prose. Details and
 * the resolved inputs belong to the run drawer, and reading them for every
 * row of a list is what the trimmed list projections exist to avoid.
 */
export const EVALUATION_LIST_COLUMNS_SQL = `
  \`Evaluations.EvaluatorId\`, \`Evaluations.Name\`, \`Evaluations.Status\`,
  \`Evaluations.Required\`, \`Evaluations.Passed\`, \`Evaluations.Score\`,
  \`Evaluations.Label\`,
  CAST([] AS Array(String)) AS \`Evaluations.Details\`,
  \`Evaluations.CostAmount\`, \`Evaluations.CostCurrency\`,
  CAST([] AS Array(String)) AS \`Evaluations.InputsJson\``;

/** The evaluations of a run as the parallel arrays its row stores. */
export function evaluationsToColumns(
  evaluations: ScenarioEvaluationResult[],
): ClickHouseEvaluationColumns {
  return {
    "Evaluations.EvaluatorId": evaluations.map((e) => e.evaluatorId),
    "Evaluations.Name": evaluations.map((e) => e.name),
    "Evaluations.Status": evaluations.map((e) => e.status),
    "Evaluations.Required": evaluations.map((e) => (e.required ? 1 : 0)),
    "Evaluations.Passed": evaluations.map((e) =>
      e.passed === undefined ? null : e.passed ? 1 : 0,
    ),
    "Evaluations.Score": evaluations.map((e) => e.score ?? null),
    "Evaluations.Label": evaluations.map((e) => e.label ?? ""),
    "Evaluations.Details": evaluations.map((e) => e.details ?? ""),
    "Evaluations.CostAmount": evaluations.map((e) => e.cost?.amount ?? null),
    "Evaluations.CostCurrency": evaluations.map((e) => e.cost?.currency ?? ""),
    "Evaluations.InputsJson": evaluations.map((e) =>
      e.inputs === undefined ? "" : JSON.stringify(e.inputs),
    ),
  };
}

const KNOWN_STATUSES = new Set<string>(SCENARIO_EVALUATION_STATUSES);

/** The status column value read back as one of the statuses we know, or `error`. */
function evaluationStatusOf(rawStatus: string): ScenarioEvaluationStatus {
  return KNOWN_STATUSES.has(rawStatus)
    ? (rawStatus as ScenarioEvaluationStatus)
    : "error";
}

/** One entry of a parallel-array column, or `undefined` past its length. */
function columnEntry<T>(column: T[] | undefined, index: number): T | undefined {
  return column ? column[index] : undefined;
}

/** One entry of a string column, read back as `""` when it carries no value. */
function stringColumnEntry(
  column: string[] | undefined,
  index: number,
): string {
  const entry = columnEntry(column, index);
  return entry === undefined ? "" : entry;
}

/** Whether a nullable numeric column entry actually carries a value. */
function isNumberColumnEntrySet(
  entry: number | null | undefined,
): entry is number {
  return entry !== null && entry !== undefined;
}

/** The cost an evaluation's row stores, or `undefined` when it charged nothing. */
function evaluationCostOf({
  record,
  index,
}: {
  record: Partial<ClickHouseEvaluationColumns>;
  index: number;
}): { currency: string; amount: number } | undefined {
  const amount = columnEntry(record["Evaluations.CostAmount"], index);
  if (!isNumberColumnEntrySet(amount)) return undefined;
  const currency = stringColumnEntry(record["Evaluations.CostCurrency"], index);
  return { currency: currency || "USD", amount: Number(amount) };
}

/** One evaluation, rebuilt from its row's parallel arrays at the given index. */
function evaluationFromColumns({
  record,
  evaluatorId,
  index,
}: {
  record: Partial<ClickHouseEvaluationColumns>;
  evaluatorId: string;
  index: number;
}): ScenarioEvaluationResult {
  const result: ScenarioEvaluationResult = {
    evaluatorId,
    name: stringColumnEntry(record["Evaluations.Name"], index),
    status: evaluationStatusOf(
      stringColumnEntry(record["Evaluations.Status"], index),
    ),
    required: columnEntry(record["Evaluations.Required"], index) === 1,
  };

  const passed = columnEntry(record["Evaluations.Passed"], index);
  if (isNumberColumnEntrySet(passed)) result.passed = passed === 1;

  const score = columnEntry(record["Evaluations.Score"], index);
  if (isNumberColumnEntrySet(score)) result.score = Number(score);

  const label = stringColumnEntry(record["Evaluations.Label"], index);
  if (label !== "") result.label = label;

  const details = stringColumnEntry(record["Evaluations.Details"], index);
  if (details !== "") result.details = details;

  const cost = evaluationCostOf({ record, index });
  if (cost) result.cost = cost;

  const inputsJson = stringColumnEntry(record["Evaluations.InputsJson"], index);
  if (inputsJson !== "") result.inputs = parseInputs(inputsJson);

  return result;
}

/**
 * The evaluations a row stores, rebuilt from its parallel arrays. A row
 * written before the columns existed reads as no evaluations, and a column
 * a trimmed read left out reads as absent on every entry.
 */
export function columnsToEvaluations(
  record: Partial<ClickHouseEvaluationColumns>,
): ScenarioEvaluationResult[] {
  const ids = record["Evaluations.EvaluatorId"] ?? [];
  return ids.map((evaluatorId, index) =>
    evaluationFromColumns({ record, evaluatorId, index }),
  );
}

function parseInputs(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      ]),
    );
  } catch {
    return {};
  }
}

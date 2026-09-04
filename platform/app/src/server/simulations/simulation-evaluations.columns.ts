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

/**
 * The evaluations a row stores, rebuilt from its parallel arrays. A row
 * written before the columns existed reads as no evaluations, and a column
 * a trimmed read left out reads as absent on every entry.
 */
export function columnsToEvaluations(
  record: Partial<ClickHouseEvaluationColumns>,
): ScenarioEvaluationResult[] {
  const ids = record["Evaluations.EvaluatorId"] ?? [];
  return ids.map((evaluatorId, i) => {
    const rawStatus = record["Evaluations.Status"]?.[i] ?? "error";
    const status: ScenarioEvaluationStatus = KNOWN_STATUSES.has(rawStatus)
      ? (rawStatus as ScenarioEvaluationStatus)
      : "error";
    const passed = record["Evaluations.Passed"]?.[i];
    const score = record["Evaluations.Score"]?.[i];
    const label = record["Evaluations.Label"]?.[i] ?? "";
    const details = record["Evaluations.Details"]?.[i] ?? "";
    const costAmount = record["Evaluations.CostAmount"]?.[i];
    const costCurrency = record["Evaluations.CostCurrency"]?.[i] ?? "";
    const inputsJson = record["Evaluations.InputsJson"]?.[i] ?? "";

    return {
      evaluatorId,
      name: record["Evaluations.Name"]?.[i] ?? "",
      status,
      required: (record["Evaluations.Required"]?.[i] ?? 0) === 1,
      ...(passed !== null && passed !== undefined && { passed: passed === 1 }),
      ...(score !== null && score !== undefined && { score: Number(score) }),
      ...(label !== "" && { label }),
      ...(details !== "" && { details }),
      ...(costAmount !== null &&
        costAmount !== undefined && {
          cost: { currency: costCurrency || "USD", amount: Number(costAmount) },
        }),
      ...(inputsJson !== "" && { inputs: parseInputs(inputsJson) }),
    };
  });
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

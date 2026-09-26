import {
  SCENARIO_CRITERION_STATUSES,
  type ScenarioCriterionResult,
  type ScenarioCriterionStatus,
} from "@langwatch/scenario-contract";

/** The `Criteria.*` parallel arrays of a `simulation_runs` row, one entry per criterion. */
export interface ClickHouseCriteriaColumns {
  "Criteria.Criterion": string[];
  "Criteria.Requirement": string[];
  "Criteria.Status": string[];
  "Criteria.Reasoning": string[];
}

/** The columns as a SELECT fragment. */
export const CRITERIA_COLUMNS_SQL = `
  \`Criteria.Criterion\`, \`Criteria.Requirement\`,
  \`Criteria.Status\`, \`Criteria.Reasoning\``;

/** The columns a list read selects: statuses without the prose, which belongs to the run drawer. */
export const CRITERIA_LIST_COLUMNS_SQL = `
  \`Criteria.Criterion\`,
  CAST([] AS Array(String)) AS \`Criteria.Requirement\`,
  \`Criteria.Status\`,
  CAST([] AS Array(String)) AS \`Criteria.Reasoning\``;

/** The criteria of a run as the parallel arrays its row stores. */
export function criteriaToColumns(criteria: ScenarioCriterionResult[]): ClickHouseCriteriaColumns {
  return {
    "Criteria.Criterion": criteria.map((c) => c.criterion),
    "Criteria.Requirement": criteria.map((c) => c.requirement ?? ""),
    "Criteria.Status": criteria.map((c) => c.status),
    "Criteria.Reasoning": criteria.map((c) => c.reasoning),
  };
}

const KNOWN_STATUSES = new Set<string>(SCENARIO_CRITERION_STATUSES);

function criterionStatusOf(rawStatus: string | undefined): ScenarioCriterionStatus {
  return rawStatus !== undefined && KNOWN_STATUSES.has(rawStatus)
    ? (rawStatus as ScenarioCriterionStatus)
    : "inconclusive";
}

/** The criteria a row stores; a row written before the columns existed reads as none. */
export function columnsToCriteria(
  record: Partial<ClickHouseCriteriaColumns>,
): ScenarioCriterionResult[] {
  const criteria = record["Criteria.Criterion"] ?? [];
  return criteria.map((criterion, index) => {
    const requirement = record["Criteria.Requirement"]?.[index] ?? "";
    return {
      criterion,
      ...(requirement !== "" && { requirement }),
      status: criterionStatusOf(record["Criteria.Status"]?.[index]),
      reasoning: record["Criteria.Reasoning"]?.[index] ?? "",
    };
  });
}

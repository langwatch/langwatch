import {
  ScenarioRunStatus,
  Verdict,
} from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";

/**
 * ClickHouse simulation_runs row shape (PascalCase, matching the table schema).
 *
 * Timestamps come back as numbers via `toUnixTimestamp64Milli`.
 */
export interface ClickHouseSimulationRunRow {
  ScenarioRunId: string;
  ScenarioId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  Status: string;
  Name: string | null;
  Description: string | null;
  Messages: string; // JSON string of Message[]
  Verdict: string | null;
  Reasoning: string | null;
  MetCriteria: string; // JSON array string
  UnmetCriteria: string; // JSON array string
  Error: string | null;
  DurationMs: string | null; // UInt64 comes as string from CH
  CreatedAt: string; // toUnixTimestamp64Milli returns a string
}

/**
 * Maps a ClickHouse simulation_runs row to the canonical ScenarioRunData type.
 *
 * Pure function — no dependencies on CH client.
 */
export function mapClickHouseRowToScenarioRunData(
  row: ClickHouseSimulationRunRow,
): ScenarioRunData {
  const messages = parseJsonArray(row.Messages);
  const status = row.Status as ScenarioRunStatus;
  const results = buildResults(row);

  return {
    scenarioRunId: row.ScenarioRunId,
    scenarioId: row.ScenarioId,
    batchRunId: row.BatchRunId,
    name: row.Name ?? null,
    description: row.Description ?? null,
    status,
    results,
    messages,
    timestamp: Number(row.CreatedAt),
    durationInMs: row.DurationMs ? Number(row.DurationMs) : 0,
  };
}

function buildResults(
  row: ClickHouseSimulationRunRow,
): ScenarioRunData["results"] {
  if (!row.Verdict) {
    return null;
  }

  return {
    verdict: row.Verdict as Verdict,
    reasoning: row.Reasoning ?? undefined,
    metCriteria: parseJsonArray(row.MetCriteria),
    unmetCriteria: parseJsonArray(row.UnmetCriteria),
    error: row.Error ?? undefined,
  };
}

function parseJsonArray(json: string): any[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

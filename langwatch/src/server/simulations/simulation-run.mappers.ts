import { ScenarioRunStatus, Verdict } from "../scenarios/scenario-event.enums";
import { resolveRunStatus } from "../scenarios/stall-detection";
import type { ScenarioRunData } from "../scenarios/scenario-event.types";

type ScenarioMessages = ScenarioRunData["messages"];

/**
 * ClickHouse row interface for simulation_runs table.
 * Columns are PascalCase matching the CH schema.
 * Timestamp columns are returned as Unix milliseconds via toUnixTimestamp64Milli().
 * Messages are stored as parallel Nested arrays (Messages.id, Messages.role, etc.).
 */
export interface ClickHouseSimulationRunRow {
  ScenarioRunId: string;
  ScenarioId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  Status: string;
  Name: string | null;
  Description: string | null;
  "Messages.Id": string[];
  "Messages.Role": string[];
  "Messages.Content": string[];
  "Messages.TraceId": string[];
  "Messages.Rest": string[];
  TraceIds: string[];
  Verdict: string | null;
  Reasoning: string | null;
  MetCriteria: string[];
  UnmetCriteria: string[];
  Error: string | null;
  DurationMs: string | null;
  CreatedAt: string;
  UpdatedAt: string;
  FinishedAt: string | null;
  DeletedAt: string | null;
}

export function mapStatus(status: string): ScenarioRunStatus {
  switch (status) {
    case "SUCCESS":
      return ScenarioRunStatus.SUCCESS;
    case "FAILURE":
    case "FAILED":
      return ScenarioRunStatus.FAILED;
    case "ERROR":
      return ScenarioRunStatus.ERROR;
    case "CANCELLED":
      return ScenarioRunStatus.CANCELLED;
    case "IN_PROGRESS":
      return ScenarioRunStatus.IN_PROGRESS;
    case "PENDING":
      return ScenarioRunStatus.PENDING;
    default:
      return ScenarioRunStatus.IN_PROGRESS;
  }
}

function mapVerdict(verdict: string | null): Verdict | undefined {
  if (!verdict) return undefined;
  switch (verdict.toLowerCase()) {
    case "success":
      return Verdict.SUCCESS;
    case "failure":
      return Verdict.FAILURE;
    case "inconclusive":
      return Verdict.INCONCLUSIVE;
    default:
      return undefined;
  }
}

/**
 * Maps a ClickHouse simulation_runs row to ScenarioRunData.
 * Applies stall detection using UpdatedAt timestamp.
 */
export function mapClickHouseRowToScenarioRunData(
  row: ClickHouseSimulationRunRow,
  now = Date.now(),
): ScenarioRunData {
  const baseStatus = mapStatus(row.Status);
  const updatedAt = Number(row.UpdatedAt);
  const createdAt = Number(row.CreatedAt);
  const finishedAt = row.FinishedAt != null ? Number(row.FinishedAt) : null;
  const durationMs = row.DurationMs != null ? parseInt(row.DurationMs, 10) : null;

  // Apply stall detection: if run has no finished timestamp, check if it's stalled
  const resolvedStatus = resolveRunStatus({
    finishedStatus: finishedAt != null ? baseStatus : undefined,
    lastEventTimestamp: updatedAt,
    now,
  });

  const verdictEnum = mapVerdict(row.Verdict);

  // Reconstruct messages from parallel Nested arrays; parse `Rest` back into fields
  const roles = row["Messages.Role"] ?? [];
  const messages = roles.map((role, i) => {
    const restStr = row["Messages.Rest"]?.[i];
    const restFields = restStr
      ? (() => { try { return JSON.parse(restStr) as Record<string, unknown>; } catch { return {}; } })()
      : {};
    return {
      ...restFields,
      id: row["Messages.Id"]?.[i] || undefined,
      role,
      content: row["Messages.Content"]?.[i] ?? null,
      trace_id: row["Messages.TraceId"]?.[i] || undefined,
    };
  }) as ScenarioMessages;

  const metCriteria = row.MetCriteria ?? [];
  const unmetCriteria = row.UnmetCriteria ?? [];

  const results =
    verdictEnum != null
      ? {
          verdict: verdictEnum,
          reasoning: row.Reasoning ?? undefined,
          metCriteria,
          unmetCriteria,
          error: row.Error ?? undefined,
        }
      : null;

  return {
    scenarioId: row.ScenarioId,
    batchRunId: row.BatchRunId,
    scenarioRunId: row.ScenarioRunId,
    name: row.Name,
    description: row.Description,
    status: resolvedStatus,
    results,
    messages,
    timestamp: updatedAt,
    durationInMs:
      durationMs ?? (finishedAt != null ? finishedAt - createdAt : updatedAt - createdAt),
  };
}

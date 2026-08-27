import {
  type SimulationRunData as ScenarioRunData,
  SimulationRunStatus as ScenarioRunStatus,
  SimulationVerdict as Verdict,
} from "@langwatch/simulation-contract";

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
  Metadata: string | null;
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
  TotalCost: number | null;
  RoleCosts: Record<string, number[]>;
  RoleLatencies: Record<string, number[]>;
  StartedAt: string | null;
  CreatedAt: string;
  UpdatedAt: string;
  FinishedAt: string | null;
  ArchivedAt: string | null;
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
    case "QUEUED":
      return ScenarioRunStatus.QUEUED;
    case "STALLED":
      return ScenarioRunStatus.STALLED;
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
 * Stored status is the only truth: runs without a finish timestamp read as
 * IN_PROGRESS regardless of age — a stalled run reaches terminal ERROR via
 * the process-manager stall watchdog, not a read-time derivation.
 */
export function mapClickHouseRowToScenarioRunData(
  row: ClickHouseSimulationRunRow,
): ScenarioRunData {
  const baseStatus = mapStatus(row.Status);
  const updatedAt = Number(row.UpdatedAt);
  const startedAt = row.StartedAt != null ? Number(row.StartedAt) : null;
  const createdAt = Number(row.CreatedAt);
  const finishedAt = row.FinishedAt != null ? Number(row.FinishedAt) : null;
  const durationMs = row.DurationMs != null ? parseInt(row.DurationMs, 10) : null;
  // Use StartedAt for duration calculation (CreatedAt is CH insertion time, which can be after FinishedAt)
  const startTimestamp = startedAt ?? createdAt;

  // Unfinished runs collapse to IN_PROGRESS; only a finished run keeps its
  // stored status.
  const resolvedStatus = finishedAt != null ? baseStatus : ScenarioRunStatus.IN_PROGRESS;

  const verdictEnum = mapVerdict(row.Verdict);

  // Reconstruct messages from parallel Nested arrays; parse `Rest` back into fields.
  // If `restFields.content` is an array, the message had structured AG-UI parts
  // (e.g. inline media that was externalized by the stored-objects pipeline)
  // and the flat Messages.Content column is empty — surface the parts array
  // to the renderer instead.
  const roles = row["Messages.Role"] ?? [];
  const messages = roles.map((role, i) => {
    const restStr = row["Messages.Rest"]?.[i];
    const restFields = restStr
      ? (() => {
          try {
            return JSON.parse(restStr) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : {};
    const { content: restContent, ...restWithoutContent } = restFields;
    const content = Array.isArray(restContent)
      ? restContent
      : (row["Messages.Content"]?.[i] ?? null);
    return {
      ...restWithoutContent,
      id: row["Messages.Id"]?.[i] || undefined,
      role,
      content,
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

  const metadata = row.Metadata
    ? (() => {
        try {
          const parsed: unknown = JSON.parse(row.Metadata);
          if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
          }
          // A run's secret parameter values never belong in a stored row, and
          // the fold projection keeps them out. Dropped again on the way out
          // so a row written by another path cannot serve one. The names, on
          // `secretParameterNames`, stay.
          const { secretParameters: _secretParameters, ...rest } = parsed as Record<
            string,
            unknown
          >;
          return rest;
        } catch {
          return null;
        }
      })()
    : null;

  return {
    scenarioId: row.ScenarioId,
    batchRunId: row.BatchRunId,
    scenarioRunId: row.ScenarioRunId,
    // The scenario set this run belongs to — used to group runs by suite
    // (run-history-transforms) and to filter ClickHouse reads by set. It no
    // longer shapes the run's platformUrl (the drawer link is run-id only).
    scenarioSetId: row.ScenarioSetId,
    name: row.Name,
    description: row.Description,
    metadata,
    status: resolvedStatus,
    results,
    messages,
    timestamp: startedAt ?? createdAt,
    updatedAt,
    durationInMs:
      durationMs ?? (finishedAt != null ? finishedAt - startTimestamp : updatedAt - startTimestamp),
    totalCost: row.TotalCost ?? undefined,
    roleCosts: row.RoleCosts && Object.keys(row.RoleCosts).length > 0 ? row.RoleCosts : undefined,
    roleLatencies:
      row.RoleLatencies && Object.keys(row.RoleLatencies).length > 0
        ? row.RoleLatencies
        : undefined,
  };
}

import {
  SimulationRunStatus,
  SimulationVerdict,
  type SimulationRunData,
  type SimulationMessage,
  simulationMessageSchema,
  simulationRunDataSchema,
} from "@langwatch/scenario-contract";

import {
  type ClickHouseEvaluationColumns,
  columnsToEvaluations,
} from "./simulation-evaluations.columns.ts";

/**
 * Timestamp columns arrive as Unix milliseconds via toUnixTimestamp64Milli().
 * Messages are stored as parallel Nested arrays (Messages.id, Messages.role, etc).
 */
export interface ClickHouseSimulationRunRow extends Partial<ClickHouseEvaluationColumns> {
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
  InconclusiveCriteria?: string[];
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
  /**
   * How many messages the run actually holds, selected only by the trimmed
   * list projection so a caller can tell a 6-message page from a 6-message
   * conversation. Absent on full-column reads, which already carry every message.
   */
  TotalMessageCount?: string;
}

export function mapStatus(status: string): SimulationRunStatus {
  switch (status) {
    case "SUCCESS":
      return SimulationRunStatus.SUCCESS;
    case "FAILURE":
    case "FAILED":
      return SimulationRunStatus.FAILED;
    case "ERROR":
      return SimulationRunStatus.ERROR;
    case "CANCELLED":
      return SimulationRunStatus.CANCELLED;
    case "IN_PROGRESS":
      return SimulationRunStatus.IN_PROGRESS;
    case "PENDING":
      return SimulationRunStatus.PENDING;
    case "QUEUED":
      return SimulationRunStatus.QUEUED;
    case "PENDING_EVALUATION":
      return SimulationRunStatus.PENDING_EVALUATION;
    case "STALLED":
      return SimulationRunStatus.STALLED;
    default:
      return SimulationRunStatus.IN_PROGRESS;
  }
}

function mapVerdict(verdict: string | null): SimulationVerdict | undefined {
  if (!verdict) return undefined;
  switch (verdict.toLowerCase()) {
    case "success":
      return SimulationVerdict.SUCCESS;
    case "failure":
      return SimulationVerdict.FAILURE;
    case "inconclusive":
      return SimulationVerdict.INCONCLUSIVE;
    default:
      return undefined;
  }
}

type RunMetadataRead = { kind: "metadata"; value: Record<string, unknown> } | { kind: "absent" };

/**
 * A run's secret parameter values never belong in a stored row; the fold keeps them out, and
 * they are dropped again here so a row written by another path cannot serve one. The names, on
 * `secretParameterNames`, stay.
 */
function readRunMetadata(raw: string | null): RunMetadataRead {
  if (!raw) return { kind: "absent" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "absent" };
    }
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
    const { secretParameters: _secretParameters, ...rest } = record;
    return { kind: "metadata", value: rest };
  } catch {
    return { kind: "absent" };
  }
}

/**
 * Maps a ClickHouse row to ScenarioRunData. Stored status is the only
 * truth: an unfinished run reads IN_PROGRESS regardless of age — ERROR and
 * PENDING_EVALUATION are set by the watchdog and the fold, not derived here.
 */
export function mapClickHouseRowToScenarioRunData(
  row: ClickHouseSimulationRunRow,
): SimulationRunData {
  const baseStatus = mapStatus(row.Status);
  const updatedAt = Number(row.UpdatedAt);
  const startedAt = row.StartedAt != null ? Number(row.StartedAt) : null;
  const createdAt = Number(row.CreatedAt);
  const finishedAt = row.FinishedAt != null ? Number(row.FinishedAt) : null;
  const durationMs = row.DurationMs != null ? parseInt(row.DurationMs, 10) : null;
  // Use StartedAt for duration (CreatedAt is CH insertion time, can be after FinishedAt)
  const startTimestamp = startedAt ?? createdAt;

  // Unfinished runs collapse to IN_PROGRESS; only a finished run keeps its
  // stored status.
  const resolvedStatus = finishedAt != null ? baseStatus : SimulationRunStatus.IN_PROGRESS;

  const verdictEnum = mapVerdict(row.Verdict);

  const messages = readMessages(row);

  // The trimmed list projection selects the real message count alongside the
  // sliced arrays. Without it (full-column reads) the row holds every message,
  // so nothing was trimmed.
  const totalMessageCount =
    row.TotalMessageCount != null ? parseInt(row.TotalMessageCount, 10) : messages.length;
  const messagesTruncated = totalMessageCount > messages.length;

  const metCriteria = row.MetCriteria ?? [];
  const unmetCriteria = row.UnmetCriteria ?? [];
  const inconclusiveCriteria = row.InconclusiveCriteria ?? [];
  const evaluations = columnsToEvaluations(row);

  const results =
    verdictEnum != null
      ? {
          verdict: verdictEnum,
          reasoning: row.Reasoning ?? undefined,
          metCriteria,
          unmetCriteria,
          ...(inconclusiveCriteria.length > 0 && { inconclusiveCriteria }),
          error: row.Error ?? undefined,
          ...(evaluations.length > 0 && { evaluations }),
        }
      : null;

  const metadataRead = readRunMetadata(row.Metadata);
  const metadata = metadataRead.kind === "metadata" ? metadataRead.value : null;

  return simulationRunDataSchema.parse({
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
    messagesTruncated,
    timestamp: startedAt ?? createdAt,
    updatedAt,
    durationInMs: durationMs ?? (finishedAt ?? updatedAt) - startTimestamp,
    ...readRoleMetrics(row),
  });
}

function readMessages(row: ClickHouseSimulationRunRow): SimulationMessage[] {
  // Reconstruct messages from parallel Nested arrays; parse `Rest` back into fields.
  // If `restFields.content` is an array, the message had structured AG-UI parts
  // (e.g. inline media that was externalized by the stored-objects pipeline)
  // and the flat Messages.Content column is empty — surface the parts array
  // to the renderer instead.
  const roles = row["Messages.Role"] ?? [];
  return simulationMessageSchema.array().parse(
    roles.map((role, i) => {
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
    }),
  );
}

function readRoleMetrics(row: ClickHouseSimulationRunRow): {
  totalCost: number | undefined;
  roleCosts: Record<string, number[]> | undefined;
  roleLatencies: Record<string, number[]> | undefined;
} {
  return {
    totalCost: row.TotalCost ?? undefined,
    roleCosts: row.RoleCosts && Object.keys(row.RoleCosts).length > 0 ? row.RoleCosts : undefined,
    roleLatencies:
      row.RoleLatencies && Object.keys(row.RoleLatencies).length > 0
        ? row.RoleLatencies
        : undefined,
  };
}

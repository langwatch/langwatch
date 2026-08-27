import type { z } from "zod";
import type { SimulationRunData } from "./simulation";
import type { ScenarioRunStatus } from "./scenario-run";
import type {
  scenarioBatchSchema,
  scenarioEventSchema,
  scenarioMessageSnapshotSchema,
  scenarioRunFinishedSchema,
  scenarioRunStartedSchema,
  scenarioTextMessageContentSchema,
  scenarioTextMessageEndSchema,
  scenarioTextMessageStartSchema,
  scenarioToolCallArgsSchema,
  scenarioToolCallEndSchema,
  scenarioToolCallStartSchema,
} from "./schemas";

// Type exports
export type ScenarioRunStartedEvent = z.infer<typeof scenarioRunStartedSchema>;
export type ScenarioRunFinishedEvent = z.infer<typeof scenarioRunFinishedSchema>;
export type ScenarioMessageSnapshotEvent = z.infer<typeof scenarioMessageSnapshotSchema>;
export type ScenarioTextMessageStartEvent = z.infer<typeof scenarioTextMessageStartSchema>;
export type ScenarioTextMessageEndEvent = z.infer<typeof scenarioTextMessageEndSchema>;
export type ScenarioTextMessageContentEvent = z.infer<typeof scenarioTextMessageContentSchema>;
export type ScenarioToolCallStartEvent = z.infer<typeof scenarioToolCallStartSchema>;
export type ScenarioToolCallArgsEvent = z.infer<typeof scenarioToolCallArgsSchema>;
export type ScenarioToolCallEndEvent = z.infer<typeof scenarioToolCallEndSchema>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
export type ScenarioBatch = z.infer<typeof scenarioBatchSchema>;
export type ScenarioRunData = SimulationRunData;

export type ScenarioSetData = {
  scenarioSetId: string;
  scenarioCount: number;
  lastRunAt: number;
};

/** First-N messages (role + content only) for sidebar preview. */
export type MessagePreview = { role: string; content: string };

/** One scenario run entry inside a BatchHistoryItem. No full messages. */
export type BatchHistoryItemRun = {
  scenarioRunId: string;
  name: string | null;
  description: string | null;
  status: ScenarioRunStatus;
  durationInMs: number;
  /** First 4 messages (2 turns) for sidebar preview. */
  messagePreview: MessagePreview[];
};

/**
 * Pre-aggregated counts for one batch run, without the per-run items.
 * A batch is complete when settledCount equals totalCount.
 */
export type BatchSummary = {
  batchRunId: string;
  totalCount: number;
  passCount: number; // SUCCESS
  failCount: number; // FAILED | FAILURE | ERROR | CANCELLED
  runningCount: number; // IN_PROGRESS | PENDING | QUEUED | RUNNING
  settledCount: number; // every status outside the running list
  stalledCount: number; // STALLED
  lastRunAt: number; // max CreatedAt (display / sort)
  lastUpdatedAt: number; // max UpdatedAt (cache comparison key)
  firstCompletedAt: number | null; // earliest completion timestamp
  allCompletedAt: number | null; // max UpdatedAt once no run is running
  /**
   * The one short line the person left with this batch, or null when the batch
   * was started without one. Every run of a batch carries the same note, so it
   * is read back off the runs themselves.
   *
   * @see specs/suites/run-notes.feature
   */
  note: string | null;
};

/**
 * Pre-aggregated batch summary for the sidebar.
 * Returned by getScenarioSetBatchHistory, with no full message arrays.
 */
export type BatchHistoryItem = BatchSummary & {
  items: BatchHistoryItemRun[];
};

export type BatchHistoryResult = {
  batches: BatchHistoryItem[];
  nextCursor?: string;
  hasMore: boolean;
  lastUpdatedAt: number; // max across all returned batches
  totalCount: number; // total distinct batch runs for this scenario set
};

/** Return type for the conditional getBatchRunData. */
export type BatchRunDataResult =
  | { changed: false; lastUpdatedAt: number }
  | { changed: true; lastUpdatedAt: number; runs: ScenarioRunData[] };

/** Summary for an external (SDK/CI) scenario set shown in the sidebar. */
export type ExternalSetSummary = {
  scenarioSetId: string;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  lastRunTimestamp: number;
};

export type SuiteRunSummary = {
  passedCount: number;
  failedCount: number;
  totalCount: number;
  lastRunTimestamp: number | null;
};

/**
 * The latest result of one scenario inside a date window, for the last-result
 * cell of the test cases table. batchRunId and scenarioSetId address the run
 * it came from so the cell can link to it.
 */
export type ScenarioLastResultSummary = {
  scenarioId: string;
  status: ScenarioRunStatus;
  metCriteriaCount: number;
  unmetCriteriaCount: number;
  /** Unix ms of the latest run's start. */
  lastRunAt: number;
  batchRunId: string;
  scenarioSetId: string;
  /** The latest run's execution time. Null while it has not finished. */
  durationInMs: number | null;
  /** The latest run's cost in USD. Null when no cost was recorded. */
  totalCost: number | null;
};

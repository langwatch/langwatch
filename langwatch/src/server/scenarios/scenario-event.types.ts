import type { z } from "zod";
import type {
  runDataSchema,
  scenarioBatchSchema,
  scenarioEventSchema,
  scenarioMessageSnapshotSchema,
  scenarioRunFinishedSchema,
  scenarioRunStartedSchema,
} from "./schemas";
import type { ScenarioRunStatus } from "./scenario-event.enums";

// Type exports
export type ScenarioRunStartedEvent = z.infer<typeof scenarioRunStartedSchema>;
export type ScenarioRunFinishedEvent = z.infer<
  typeof scenarioRunFinishedSchema
>;
export type ScenarioMessageSnapshotEvent = z.infer<
  typeof scenarioMessageSnapshotSchema
>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
export type ScenarioBatch = z.infer<typeof scenarioBatchSchema>;
export type ScenarioRunData = z.infer<typeof runDataSchema>;

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
 * Pre-aggregated batch summary for the sidebar.
 * Returned by getScenarioSetBatchHistory — no full message arrays.
 */
export type BatchHistoryItem = {
  batchRunId: string;
  totalCount: number;
  passCount: number;    // SUCCESS
  failCount: number;    // FAILED | FAILURE | ERROR | CANCELLED
  runningCount: number; // IN_PROGRESS | PENDING
  stalledCount: number; // STALLED
  lastRunAt: number;    // max CreatedAt (display / sort)
  lastUpdatedAt: number; // max UpdatedAt (cache comparison key)
  firstCompletedAt: number | null; // earliest completion timestamp
  allCompletedAt: number | null;   // latest non-stalled/running completion timestamp
  items: BatchHistoryItemRun[];
};

export type BatchHistoryResult = {
  batches: BatchHistoryItem[];
  nextCursor?: string;
  hasMore: boolean;
  lastUpdatedAt: number; // max across all returned batches
  totalCount: number;    // total distinct batch runs for this scenario set
};

/** Return type for the conditional getBatchRunData. */
export type BatchRunDataResult =
  | { changed: false; lastUpdatedAt: number }
  | { changed: true; lastUpdatedAt: number; runs: ScenarioRunData[] };

import type { z } from "zod";
import type {
  runDataSchema,
  scenarioBatchSchema,
  scenarioEventSchema,
  scenarioMessageSnapshotSchema,
  scenarioRunFinishedSchema,
  scenarioRunStartedSchema,
  scenarioTextMessageStartSchema,
  scenarioTextMessageEndSchema,
  scenarioTextMessageContentSchema,
  scenarioToolCallStartSchema,
  scenarioToolCallArgsSchema,
  scenarioToolCallEndSchema,
} from "./schemas";
import type { ScenarioRunStatus } from "./scenario-event.enums";

// Type exports
export type ScenarioRunStartedEvent = z.infer<typeof scenarioRunStartedSchema>;
export type ScenarioRunFinishedEvent = z.infer<
  typeof scenarioRunFinishedSchema
>;
/**
 * A single message inside a MESSAGE_SNAPSHOT. The runtime schema validates it as
 * an @ag-ui/core `Message` | tracer chat message | scenario audio message,
 * intersected with `{ id?, trace_id? }`. Under zod 4 that intersection-of-union
 * no longer infers a usable type through the @ag-ui boundary (@ag-ui ships
 * zod-3-shaped .d.ts), and the consumers here are defensive/dynamic anyway
 * (runtime `typeof` / `in` checks, `role as MessageRole` casts), so we describe
 * the accessed surface explicitly. Type-only — the runtime schema is unchanged.
 */
export type ScenarioSnapshotMessage = {
  id?: string;
  trace_id?: string;
  role?: string;
  content?: unknown;
  toolCallId?: string;
  toolCalls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

export type ScenarioMessageSnapshotEvent = Omit<
  z.infer<typeof scenarioMessageSnapshotSchema>,
  "messages"
> & { messages: ScenarioSnapshotMessage[] };
export type ScenarioTextMessageStartEvent = z.infer<typeof scenarioTextMessageStartSchema>;
export type ScenarioTextMessageEndEvent = z.infer<typeof scenarioTextMessageEndSchema>;
export type ScenarioTextMessageContentEvent = z.infer<typeof scenarioTextMessageContentSchema>;
export type ScenarioToolCallStartEvent = z.infer<typeof scenarioToolCallStartSchema>;
export type ScenarioToolCallArgsEvent = z.infer<typeof scenarioToolCallArgsSchema>;
export type ScenarioToolCallEndEvent = z.infer<typeof scenarioToolCallEndSchema>;
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

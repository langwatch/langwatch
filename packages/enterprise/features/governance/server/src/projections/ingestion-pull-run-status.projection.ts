import {
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_RUN_OUTCOME,
  type IngestionPullProcessingEvent,
} from "@langwatch/enterprise-governance-contract";

export type IngestionPullRunStatus = {
  sourceId: string;
  enabled: boolean;
  cron: string | null;
  cursor: string | null;
  lastRunAt: number | null;
  lastRunOutcome: "completed" | "failed" | null;
  lastRunEventCount: number;
  lastRunError: string | null;
  lastRunErrorCode: string | null;
  consecutiveErrors: number;
  lastRunScheduledFor: number | null;
};

export class IngestionPullRunStatusProjection {
  static create(): IngestionPullRunStatusProjection {
    return new IngestionPullRunStatusProjection();
  }

  initial(): IngestionPullRunStatus {
    return {
      sourceId: "",
      enabled: false,
      cron: null,
      cursor: null,
      lastRunAt: null,
      lastRunOutcome: null,
      lastRunEventCount: 0,
      lastRunError: null,
      lastRunErrorCode: null,
      consecutiveErrors: 0,
      lastRunScheduledFor: null,
    };
  }

  fold(
    state: IngestionPullRunStatus,
    event: IngestionPullProcessingEvent,
  ): IngestionPullRunStatus {
    switch (event.type) {
      case INGESTION_PULL_EVENT_TYPES.CONFIGURED:
        return {
          ...state,
          sourceId: event.data.sourceId,
          enabled: true,
          cron: event.data.cron,
          cursor: state.sourceId ? state.cursor : event.data.cursor,
        };
      case INGESTION_PULL_EVENT_TYPES.DISABLED:
        return { ...state, sourceId: event.data.sourceId, enabled: false, cron: null };
      case INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED:
        if (
          state.lastRunScheduledFor !== null &&
          event.data.scheduledFor < state.lastRunScheduledFor
        ) return state;
        return {
          ...state,
          sourceId: event.data.sourceId,
          cursor: event.data.nextCursor,
          lastRunAt: event.occurredAt,
          lastRunOutcome: INGESTION_PULL_RUN_OUTCOME.COMPLETED,
          lastRunEventCount: event.data.eventCount,
          lastRunError: null,
          lastRunErrorCode: null,
          consecutiveErrors: 0,
          lastRunScheduledFor: event.data.scheduledFor,
        };
      case INGESTION_PULL_EVENT_TYPES.RUN_FAILED:
        if (
          state.lastRunScheduledFor !== null &&
          event.data.scheduledFor < state.lastRunScheduledFor
        ) return state;
        return {
          ...state,
          sourceId: event.data.sourceId,
          lastRunAt: event.occurredAt,
          lastRunOutcome: INGESTION_PULL_RUN_OUTCOME.FAILED,
          lastRunEventCount: 0,
          lastRunError: event.data.error,
          lastRunErrorCode: event.data.errorCode,
          consecutiveErrors: state.consecutiveErrors + 1,
          lastRunScheduledFor: event.data.scheduledFor,
        };
    }
  }
}

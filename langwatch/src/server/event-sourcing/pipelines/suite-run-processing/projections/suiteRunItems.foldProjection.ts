import type {
  FoldProjectionDefinition,
  FoldProjectionStore,
} from "../../../projections/foldProjection.types";
import {
  SUITE_RUN_EVENT_TYPES,
  SUITE_RUN_PROJECTION_VERSIONS,
} from "../schemas/constants";
import type { SuiteRunProcessingEvent } from "../schemas/events";
import {
  isSuiteRunScenarioStartedEvent,
  isSuiteRunScenarioResultEvent,
} from "../schemas/typeGuards";

/**
 * Per-scenario item data within a suite run.
 * PascalCase fields match ClickHouse column naming.
 */
export interface SuiteRunItemData {
  ScenarioRunId: string;
  ScenarioId: string;
  TargetReferenceId: string;
  TargetType: string;
  Status: string;
  Verdict: string | null;
  DurationMs: number | null;
  StartedAt: number | null;
  FinishedAt: number | null;
  UpdatedAt: number;
}

/**
 * Collection fold state: all items for one aggregate (suiteId:batchRunId).
 */
export interface SuiteRunItemsData {
  items: Record<string, SuiteRunItemData>;
}

function init(): SuiteRunItemsData {
  return { items: {} };
}

function apply(
  state: SuiteRunItemsData,
  event: SuiteRunProcessingEvent,
): SuiteRunItemsData {
  if (isSuiteRunScenarioStartedEvent(event)) {
    const item: SuiteRunItemData = {
      ScenarioRunId: event.data.scenarioRunId,
      ScenarioId: event.data.scenarioId,
      TargetReferenceId: event.data.targetReferenceId,
      TargetType: event.data.targetType,
      Status: "IN_PROGRESS",
      Verdict: null,
      DurationMs: null,
      StartedAt: event.occurredAt,
      FinishedAt: null,
      UpdatedAt: Date.now(),
    };
    return {
      items: { ...state.items, [event.data.scenarioRunId]: item },
    };
  }

  if (isSuiteRunScenarioResultEvent(event)) {
    const existing = state.items[event.data.scenarioRunId];
    const item: SuiteRunItemData = {
      ScenarioRunId: event.data.scenarioRunId,
      ScenarioId: existing?.ScenarioId ?? event.data.scenarioId,
      TargetReferenceId: existing?.TargetReferenceId ?? event.data.targetReferenceId,
      TargetType: existing?.TargetType ?? event.data.targetType,
      Status: event.data.status.toUpperCase(),
      Verdict: event.data.verdict ?? null,
      DurationMs: event.data.durationMs ?? null,
      StartedAt: existing?.StartedAt ?? null,
      FinishedAt: event.occurredAt,
      UpdatedAt: Date.now(),
    };
    return {
      items: { ...state.items, [event.data.scenarioRunId]: item },
    };
  }

  return state;
}

/**
 * Creates FoldProjection definition for suite run items.
 *
 * Fold state is a collection of per-scenario items. On each event,
 * the full collection is loaded, one item is updated, and all items
 * are written back (ReplacingMergeTree deduplicates unchanged rows).
 */
export function createSuiteRunItemsFoldProjection(deps: {
  store: FoldProjectionStore<SuiteRunItemsData>;
}): FoldProjectionDefinition<SuiteRunItemsData, SuiteRunProcessingEvent> {
  return {
    name: "suiteRunItems",
    version: SUITE_RUN_PROJECTION_VERSIONS.RUN_ITEMS,
    eventTypes: [
      SUITE_RUN_EVENT_TYPES.SCENARIO_STARTED,
      SUITE_RUN_EVENT_TYPES.SCENARIO_RESULT,
    ],
    init,
    apply,
    store: deps.store,
  };
}

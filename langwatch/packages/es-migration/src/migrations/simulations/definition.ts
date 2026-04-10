import type { Event } from "~/server/event-sourcing/domain/types.js";
import {
  SimulationRunStateFoldProjection,
  type SimulationRunStateData,
} from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection.js";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "~/server/event-sourcing/pipelines/simulation-processing/schemas/constants.js";
import type {
  SimulationMessageSnapshotEvent,
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
  SimulationRunStartedEvent,
} from "~/server/event-sourcing/pipelines/simulation-processing/schemas/events.js";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types.js";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils.js";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils.js";
import type {
  DirectWriteResult,
  DiscoveryMigrationDefinition,
  EsHit,
} from "../../lib/types.js";
import { createTenantId } from "~/server/event-sourcing/index.js";

export interface EsScenarioEvent extends EsHit {
  project_id: string;
  type:
    | "RUN_STARTED"
    | "RUN_FINISHED"
    | "MESSAGE_SNAPSHOT"
    | "SCENARIO_RUN_STARTED"
    | "SCENARIO_RUN_FINISHED"
    | "SCENARIO_MESSAGE_SNAPSHOT";
  timestamp: number;
  scenario_id: string;
  scenario_run_id: string;
  batch_run_id: string;
  scenario_set_id?: string;
  metadata?: { name?: string; description?: string };
  status?: string;
  results?: {
    verdict: string;
    reasoning?: string;
    // ES uses both snake_case and camelCase depending on event age
    met_criteria?: string[];
    unmet_criteria?: string[];
    metCriteria?: string[];
    unmetCriteria?: string[];
    error?: string;
  };
  messages?: Array<{
    id?: string;
    role: string;
    content?: string;
    trace_id?: string;
    [key: string]: unknown;
  }>;
}

interface SimulationMigrationDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
}

/** Normalize timestamp to milliseconds. Handles string and number inputs. */
function toEpochMs(ts: number | string): number {
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (Number.isNaN(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

/** Event ordering: start → message → finish. */
const EVENT_ORDER: Record<string, number> = {
  RUN_STARTED: 0,
  SCENARIO_RUN_STARTED: 0,
  MESSAGE_SNAPSHOT: 1,
  SCENARIO_MESSAGE_SNAPSHOT: 1,
  RUN_FINISHED: 2,
  SCENARIO_RUN_FINISHED: 2,
};

export function createSimulationMigrationDefinition(
  deps: SimulationMigrationDeps,
): DiscoveryMigrationDefinition {
  const noopStore = {
    get: async () => null,
    store: async () => {},
  };

  // Create projection definition to reuse init/apply pure functions
  const foldProjection = new SimulationRunStateFoldProjection({
    store: noopStore as any,
  });

  return {
    name: "simulations",
    esIndex: "scenario-events-alias",
    esSort: [{ timestamp: "asc" }, { scenario_run_id: "asc" }],
    aggregateType: "simulation_run",
    aggregateIdField: "scenario_run_id",
    tenantIdField: "project_id",
    timestampField: "timestamp",

    processAggregate(
      rawEvents: EsHit[],
      aggregateId: string,
    ): DirectWriteResult {
      const events = rawEvents as unknown as EsScenarioEvent[];

      // Sort events: start → message → finish
      const sorted = [...events].sort(
        (a, b) => (EVENT_ORDER[a.type] ?? 99) - (EVENT_ORDER[b.type] ?? 99),
      );

      // Must have a start event
      const startEvent = sorted.find(
        (e) => e.type === "RUN_STARTED" || e.type === "SCENARIO_RUN_STARTED",
      );
      if (!startEvent) {
        return {
          eventRecords: [],
          projectionWrites: [],
          commandCount: 0,
          projectionState: null,
        };
      }

      const tenantId = startEvent.project_id;
      const scenarioRunId = startEvent.scenario_run_id;

      // Only keep the last MESSAGE_SNAPSHOT (cumulative — each repeats all previous messages)
      const snapshots = sorted.filter(
        (e) =>
          e.type === "MESSAGE_SNAPSHOT" ||
          e.type === "SCENARIO_MESSAGE_SNAPSHOT",
      );
      const lastSnapshot = snapshots[snapshots.length - 1];
      const eventsToProcess = sorted.filter((e) => {
        if (
          e.type === "MESSAGE_SNAPSHOT" ||
          e.type === "SCENARIO_MESSAGE_SNAPSHOT"
        ) {
          return e === lastSnapshot;
        }
        return true;
      });

      // Create domain events in memory
      const allEvents: Event[] = [];
      for (const esEvent of eventsToProcess) {
        const event = esEventToDomainEvent(esEvent, tenantId, scenarioRunId);
        if (event) allEvents.push(event);
      }

      if (allEvents.length === 0) {
        return {
          eventRecords: [],
          projectionWrites: [],
          commandCount: 0,
          projectionState: null,
        };
      }

      // Compute fold projection in memory
      let state = foldProjection.init();
      for (const event of allEvents) {
        state = foldProjection.apply(state, event as SimulationProcessingEvent);
      }

      // Override timestamps — fold uses Date.now() which would be migration time
      const startedAt = toEpochMs(startEvent.timestamp);
      const lastEvent = sorted[sorted.length - 1]!;
      const updatedAt = toEpochMs(lastEvent.timestamp);
      state = {
        ...state,
        CreatedAt: startedAt,
        UpdatedAt: updatedAt,
      };

      // Convert to event records
      const eventRecords = allEvents.map(eventToRecord);

      // Build projection write
      const storeContext = {
        aggregateId: scenarioRunId,
        tenantId: createTenantId(tenantId),
      };
      const projectionWrites: Array<() => Promise<void>> = [
        () => deps.simulationRunStore.store(state, storeContext),
      ];

      return {
        eventRecords,
        projectionWrites,
        commandCount: allEvents.length,
        projectionState: state,
      };
    },
  };
}

function esEventToDomainEvent(
  esEvent: EsScenarioEvent,
  tenantId: string,
  scenarioRunId: string,
): Event | null {
  const occurredAt = toEpochMs(esEvent.timestamp);
  const esId = esEvent._id;

  switch (esEvent.type) {
    case "RUN_STARTED":
    case "SCENARIO_RUN_STARTED":
      return EventUtils.createEvent<SimulationRunStartedEvent>({
        aggregateType: "simulation_run",
        aggregateId: scenarioRunId,
        tenantId: createTenantId(tenantId),
        type: SIMULATION_RUN_EVENT_TYPES.STARTED,
        version: SIMULATION_EVENT_VERSIONS.STARTED,
        data: {
          scenarioRunId,
          scenarioId: esEvent.scenario_id,
          batchRunId: esEvent.batch_run_id,
          scenarioSetId: esEvent.scenario_set_id ?? "default",
          name: esEvent.metadata?.name,
          description: esEvent.metadata?.description,
        },
        occurredAt,
        idempotencyKey: `${tenantId}:${scenarioRunId}:startRun`,
      });

    case "MESSAGE_SNAPSHOT":
    case "SCENARIO_MESSAGE_SNAPSHOT": {
      const messages = esEvent.messages ?? [];
      const traceIds = messages
        .map((m) => m.trace_id)
        .filter((id): id is string => !!id);

      return EventUtils.createEvent<SimulationMessageSnapshotEvent>({
        aggregateType: "simulation_run",
        aggregateId: scenarioRunId,
        tenantId: createTenantId(tenantId),
        type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
        version: SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT,
        data: {
          scenarioRunId,
          messages,
          traceIds,
        },
        occurredAt,
        idempotencyKey: `${tenantId}:${scenarioRunId}:${esId}:snapshot`,
      });
    }

    case "RUN_FINISHED":
    case "SCENARIO_RUN_FINISHED":
      return EventUtils.createEvent<SimulationRunFinishedEvent>({
        aggregateType: "simulation_run",
        aggregateId: scenarioRunId,
        tenantId: createTenantId(tenantId),
        type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
        version: SIMULATION_EVENT_VERSIONS.FINISHED,
        data: {
          scenarioRunId,
          results: esEvent.results
            ? {
                verdict: esEvent.results.verdict as any,
                reasoning: esEvent.results.reasoning,
                metCriteria:
                  esEvent.results.metCriteria ??
                  esEvent.results.met_criteria ??
                  [],
                unmetCriteria:
                  esEvent.results.unmetCriteria ??
                  esEvent.results.unmet_criteria ??
                  [],
                error: esEvent.results.error,
              }
            : undefined,
          status: esEvent.status,
        },
        occurredAt,
        idempotencyKey: `${tenantId}:${scenarioRunId}:finishRun`,
      });

    default:
      return null;
  }
}

/**
 * Generic Event Sourcing Library
 *
 * This library provides the core interfaces and patterns for event-sourced systems.
 * It can be reused across different domains (traces, users, etc.) by implementing
 * the specific event and projection types.
 */

// Core types & stream
export {
  EventStream,
} from "./core/eventStream";
export type {
  Event,
  EventOrderingStrategy,
  Projection,
  ProjectionEnvelope,
  ProjectionMetadata,
} from "./core/types";

// Processing interfaces
export type { EventHandler } from "./processing/eventHandler";

// Store interfaces
export type { EventStore, ReadOnlyEventStore, EventStoreReadContext } from "./stores/eventStore";
export type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "./stores/projectionStore.types";

// Services & pipeline
export {
  EventSourcingService,
} from "./services/eventSourcingService";
export type {
  EventSourcingHooks,
  EventSourcingOptions,
  RebuildProjectionOptions,
} from "./services/eventSourcingService";
export {
  createEventSourcingPipeline,
} from "./services/createEventSourcingPipeline";

// Utility functions
export {
  createEvent,
  createEventStream,
  createProjection,
  eventBelongsToAggregate,
  sortEventsByTimestamp,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  buildProjectionMetadata,
  EventUtils,
} from "./utils/event.utils";

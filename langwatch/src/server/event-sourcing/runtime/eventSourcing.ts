import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Event, EventStore, Projection } from "../library";
import { DisabledPipelineBuilder } from "./disabledPipeline";
import type { EventSourcingRuntime } from "./eventSourcingRuntime";
import { getEventSourcingRuntime } from "./eventSourcingRuntime";
import { PipelineBuilder } from "./pipeline";

/**
 * Singleton that manages shared event sourcing infrastructure.
 * Provides a single event store instance that can be used by all pipelines,
 * since the database partitions by tenantId + aggregateType.
 *
 * **Design Considerations:**
 * - Uses singleton pattern for simplicity and shared state in production
 * - Delegates to EventSourcingRuntime for store creation and configuration
 * - Supports graceful degradation via ENABLE_EVENT_SOURCING env var
 * - Supports dependency injection via runtime parameter for testing
 *
 * **Usage:**
 * - Production: Use singleton via `EventSourcing.getInstance()` or `eventSourcing` export
 * - Testing: Use constructor with custom runtime: `new EventSourcing(EventSourcingRuntime.createForTesting(...))`
 */
export class EventSourcing {
  private static instance: EventSourcing | null = null;
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.runtime",
  );

  constructor(
    private readonly runtime: EventSourcingRuntime = getEventSourcingRuntime(),
  ) {}

  /**
   * Whether event sourcing is enabled.
   * When false, pipelines will be no-ops that log warnings.
   */
  get isEnabled(): boolean {
    return this.runtime.isEnabled;
  }

  /**
   * Returns the singleton instance of EventSourcing.
   * Creates a new instance with auto-selected stores on first call.
   */
  static getInstance(): EventSourcing {
    if (!EventSourcing.instance) {
      EventSourcing.instance = new EventSourcing();
    }
    return EventSourcing.instance;
  }

  /**
   * Resets the singleton instance. Only use in tests.
   */
  static resetInstance(): void {
    EventSourcing.instance = null;
  }

  /**
   * Returns the shared event store instance.
   *
   * This single instance handles all aggregate types by accepting aggregateType as a method parameter.
   * The store partitions data by tenantId + aggregateType internally, allowing a single instance
   * to serve multiple pipelines efficiently.
   *
   * Returns undefined if event sourcing is disabled.
   */
  getEventStore<EventType extends Event>(): EventStore<EventType> | undefined {
    return this.runtime.eventStore as EventStore<EventType> | undefined;
  }

  /**
   * Starts building a new event sourcing pipeline.
   * Returns a builder that enforces required fields through TypeScript types.
   *
   * If event sourcing is disabled (ENABLE_EVENT_SOURCING=false), returns a
   * DisabledPipelineBuilder that creates no-op pipelines that log warnings.
   */
  registerPipeline<EventType extends Event>():
    | PipelineBuilder<EventType>
    | DisabledPipelineBuilder<EventType> {
    return this.tracer.withActiveSpan(
      "EventSourcing.registerPipeline",
      {
        kind: SpanKind.INTERNAL,
      },
      () => {
        // Return disabled builder if event sourcing is disabled
        if (!this.runtime.isEnabled || !this.runtime.eventStore) {
          this.runtime.logDisabledWarning({ pipeline: "registerPipeline" });
          return new DisabledPipelineBuilder<EventType>();
        }

        return new PipelineBuilder<EventType>({
          eventStore: this.runtime.eventStore as EventStore<EventType>,
          queueProcessorFactory: this.runtime.queueProcessorFactory,
          distributedLock: this.runtime.distributedLock,
          processorCheckpointStore: this.runtime.checkpointStore,
        });
      },
    );
  }
}

export const eventSourcing = EventSourcing.getInstance();

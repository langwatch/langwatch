import { createTenantId } from "../domain/tenantId.ts";
import type {
  OwnEventStore,
  OwnEventsAppend,
  PriorEventsRead,
} from "../pipeline/feature-eventing.ts";
import { ConfigurationError } from "../services/errorHandling.ts";
import type { EventStore } from "./eventStore.types.ts";

/** The runtime's log, read at call time: a runtime opens its store only once it initialises. */
export type OwnEventLog = () => Pick<EventStore, "getEvents" | "storeEvents"> | undefined;

/** Which operation a refusal names. */
type OwnEventOperation = "append" | "read";

/**
 * One pipeline's own streams over its runtime's event log, bound to the aggregate its
 * definition declares once built. Before that, and where the process opened no log, every
 * operation refuses by name. Spec: packages/eventing/specs/own-event-store.feature.
 */
export class PipelineEventStore implements OwnEventStore {
  static create(options: { pipeline: string; log: OwnEventLog }): PipelineEventStore {
    return new PipelineEventStore(options.pipeline, options.log);
  }

  #aggregateType: string | undefined;

  private constructor(
    private readonly pipeline: string,
    private readonly log: OwnEventLog,
  ) {}

  /** Binds to the aggregate a built definition declares; naming none leaves it unbound. */
  bindTo(definition: unknown): void {
    this.#aggregateType = aggregateTypeOf(definition);
  }

  readonly append = async ({ tenantId, events }: OwnEventsAppend): Promise<void> => {
    const { aggregateType, log } = this.#open("append");
    const foreign = events.find((event) => event.aggregateType !== aggregateType);
    if (foreign) {
      throw this.#refuse({
        operation: "append",
        details: `appends only its own "${aggregateType}" aggregate, and refused an event of "${foreign.aggregateType}".`,
        context: { aggregateType: foreign.aggregateType },
      });
    }
    await log.storeEvents(events, { tenantId: createTenantId(tenantId) }, aggregateType);
  };

  readonly read: PriorEventsRead = async ({ tenantId, aggregateId, accepts }) => {
    const { aggregateType, log } = this.#open("read");
    const events: readonly unknown[] = await log.getEvents({
      aggregateId,
      context: { tenantId: createTenantId(tenantId) },
      aggregateType,
    });
    return events.filter(accepts);
  };

  #open(operation: OwnEventOperation): {
    aggregateType: string;
    log: Pick<EventStore, "getEvents" | "storeEvents">;
  } {
    const aggregateType = this.#aggregateType;
    if (aggregateType === void 0) {
      throw this.#refuse({
        operation,
        details: `cannot ${operation} its own events before its definition names an aggregate.`,
      });
    }
    const log = this.log();
    if (log === void 0) {
      throw this.#refuse({
        operation,
        details: `cannot ${operation} its own events: this process's eventing holds no event log.`,
      });
    }
    return { aggregateType, log };
  }

  #refuse({
    operation,
    details,
    context = {},
  }: {
    operation: OwnEventOperation;
    details: string;
    context?: Record<string, unknown>;
  }): ConfigurationError {
    return new ConfigurationError("PipelineEventStore", `Pipeline "${this.pipeline}" ${details}`, {
      ...context,
      pipeline: this.pipeline,
      operation,
    });
  }
}

/** The aggregate a built definition declares, read without asserting a shape it may not have. */
function aggregateTypeOf(definition: unknown): string | undefined {
  if (typeof definition !== "object" || definition === null) return void 0;
  if (!("aggregate" in definition)) return void 0;
  const aggregate = definition.aggregate;
  if (typeof aggregate !== "object" || aggregate === null || !("type" in aggregate)) return void 0;
  return typeof aggregate.type === "string" ? aggregate.type : void 0;
}

import { ConfigurationError, ValidationError } from "../services/errorHandling.ts";

/**
 * One stored event type the owning pipeline now reads as one of its current types (ARCHITECTURE §9;
 * Alex, 2026-10-06). Spec: packages/eventing/specs/event-upcast.feature.
 */
export interface EventUpcast<To extends string = string> {
  /** The stored type, and the stored aggregate type when the aggregate was renamed with it. */
  readonly from: { readonly type: string; readonly aggregateType?: string };
  /** The current type it reads as; the pipeline's `.withEvents` declares it. */
  readonly to: To;
  /** The version the current schema pins, when the stored rows carry another. */
  readonly version?: string;
  /** A pure transform of the stored payload; the current schema parses its result. */
  readonly data?: (stored: unknown) => unknown;
}

/** Jobs a previous release queued under a former pipeline's keys, drained into this one's lanes. */
export interface UpcastDrain {
  /** The former pipeline name its queue registry and dedup keys carry. */
  readonly pipeline: string;
  /** Former lane names by the current name they drain into; an absent lane keeps its name. */
  readonly jobNames?: Readonly<Record<string, string>>;
}

/** What `.withUpcasts` declares: the upcast events and, for a pipeline rename, the drain. */
export interface UpcastDeclaration<To extends string = string> {
  readonly events: readonly EventUpcast<To>[];
  readonly drain?: UpcastDrain;
}

/** A pipeline's upcasts as a built definition carries them, for the runtime, replay and ops. */
export interface PipelineUpcasts {
  readonly pipeline: string;
  readonly aggregateType: string;
  readonly events: readonly EventUpcast[];
  readonly drain?: UpcastDrain;
}

/** The ledger and ops id of one upcast: the owning pipeline and the stored type it covers. */
export function upcastStepId({ pipeline, from }: { pipeline: string; from: string }): string {
  return `upcast:${pipeline}:${from}`;
}

/** Refuses a declaration that could never apply, naming the type, when the pipeline is built. */
export function assertUpcastsDeclarable({
  pipeline,
  declaredTypes,
  events,
}: {
  pipeline: string;
  declaredTypes: ReadonlySet<string>;
  events: readonly EventUpcast[];
}): void {
  const seen = new Set<string>();
  for (const upcast of events) {
    const refuse = (details: string) =>
      new ConfigurationError("PipelineBuilder", `Pipeline "${pipeline}" ${details}`, {
        pipeline,
        from: upcast.from.type,
        to: upcast.to,
      });
    if (!declaredTypes.has(upcast.to)) {
      throw refuse(`upcasts to "${upcast.to}", which its .withEvents does not declare.`);
    }
    if (declaredTypes.has(upcast.from.type)) {
      throw refuse(`upcasts from "${upcast.from.type}", which it still declares as current.`);
    }
    if (seen.has(upcast.from.type)) {
      throw refuse(`declares two upcasts from "${upcast.from.type}".`);
    }
    seen.add(upcast.from.type);
  }
}

/** The fields an upcast rewrites, on a stored, queued or replayed event. */
export interface UpcastableEvent {
  readonly id: string;
  readonly type: string;
  readonly aggregateType: string;
  readonly version: string;
  readonly data: unknown;
}

function isUpcastable(value: unknown): value is UpcastableEvent {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || !("aggregateType" in value) || !("version" in value)) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.aggregateType === "string" &&
    typeof value.version === "string"
  );
}

/** Applies one pipeline's upcasts to a stored or queued event; anything else passes untouched. */
export class EventUpcaster {
  static of(upcasts: PipelineUpcasts | undefined): EventUpcaster {
    return new EventUpcaster(upcasts);
  }

  readonly #byFrom: ReadonlyMap<string, EventUpcast>;

  private constructor(readonly upcasts: PipelineUpcasts | undefined) {
    this.#byFrom = new Map((upcasts?.events ?? []).map((upcast) => [upcast.from.type, upcast]));
  }

  get active(): boolean {
    return this.#byFrom.size > 0;
  }

  /** The stored aggregate types a read of the pipeline's own aggregate also covers. */
  get formerAggregateTypes(): readonly string[] {
    const own = this.upcasts?.aggregateType;
    const former = [...this.#byFrom.values()].flatMap((upcast) => upcast.from.aggregateType ?? []);
    return [...new Set(former)].filter((type) => type !== own);
  }

  declaresFrom(type: unknown): boolean {
    return typeof type === "string" && this.#byFrom.has(type);
  }

  /** The given current types and every stored type that reads as one of them. */
  widenTypes(types: readonly string[]): string[] {
    const wanted = new Set(types);
    const stored = [...this.#byFrom.values()]
      .filter((upcast) => wanted.has(upcast.to))
      .map((upcast) => upcast.from.type);
    return [...types, ...stored.filter((type) => !wanted.has(type))];
  }

  /** The current type a stored type reads as, or the type itself. */
  currentType(type: string): string {
    return this.#byFrom.get(type)?.to ?? type;
  }

  /** The current aggregate type for a stored aggregate type this pipeline renamed, or itself. */
  currentAggregateType(aggregateType: string): string {
    const renamed = this.formerAggregateTypes.includes(aggregateType);
    return renamed && this.upcasts ? this.upcasts.aggregateType : aggregateType;
  }

  /** The stored event read as the current one; any other event is answered as it is. */
  apply<E extends UpcastableEvent>(event: E): E {
    const upcast = this.#byFrom.get(event.type);
    if (!upcast || !this.upcasts) return event;
    const renamesAggregate =
      upcast.from.aggregateType !== undefined && event.aggregateType === upcast.from.aggregateType;
    return {
      ...event,
      type: upcast.to,
      aggregateType: renamesAggregate ? this.upcasts.aggregateType : event.aggregateType,
      version: upcast.version ?? event.version,
      data: upcast.data ? this.#transform({ upcast, event }) : event.data,
    };
  }

  /** A queued payload, still unparsed: upcast when it is a stored event of a former type. */
  applyToPayload(value: unknown): unknown {
    return isUpcastable(value) ? this.apply(value) : value;
  }

  #transform({ upcast, event }: { upcast: EventUpcast; event: UpcastableEvent }): unknown {
    try {
      return upcast.data?.(event.data);
    } catch (error) {
      throw new ValidationError({
        reason: `Upcast "${upcastStepId({ pipeline: this.upcasts?.pipeline ?? "", from: upcast.from.type })}" could not transform a stored payload: ${error instanceof Error ? error.message : String(error)}`,
        field: "data",
        context: { eventId: event.id, from: upcast.from.type, to: upcast.to },
      });
    }
  }
}

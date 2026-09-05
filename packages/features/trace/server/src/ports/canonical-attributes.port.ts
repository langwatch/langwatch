import type {
  CanonicalAttributes,
  CanonicalEvent,
  CanonicalSpanContext,
} from "@langwatch/trace-contract";

/** Span input and output shared by canonicalisation extractors. */
export type ExtractorContext = {
  bag: CanonicalSpanStore;
  out: CanonicalAttributes;
  span: CanonicalSpanContext;

  recordRule: (ruleId: string) => void;
  setAttr: (key: string, value: unknown) => void;
  setAttrIfAbsent: (key: string, value: unknown) => void;
};

/** Log input and output for extractors that support receiver-side logs. */
export type LogExtractorContext = {
  bag: CanonicalLogRecordStore;
  out: CanonicalAttributes;
  recordRule: (ruleId: string) => void;
  setAttr: (key: string, value: unknown) => void;
  setAttrIfAbsent: (key: string, value: unknown) => void;
};

export abstract class CanonicalAttributesPort {
  abstract readonly id: string;

  /** Span canonicalisation. Extractors consume owned bag values and record rules. */
  abstract apply(ctx: ExtractorContext): void;

  /** Optional log canonicalisation; span and log passes remain independent. */
  abstract applyLog?(ctx: LogExtractorContext): void;
}

export class CanonicalAttributeStore {
  private readonly map: Map<string, unknown>;

  private constructor(input: CanonicalAttributes) {
    this.map = new Map(Object.entries(input));
  }

  static create(input: CanonicalAttributes): CanonicalAttributeStore {
    return new CanonicalAttributeStore(input);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): unknown {
    return this.map.get(key);
  }

  /**
   * @deprecated Values are now pre-parsed during normalization.
   * Use `get()` instead — it returns the already-parsed value.
   */
  getParsed(key: string, _maxSafeSize?: number): unknown {
    return this.map.get(key);
  }

  take(key: string): unknown {
    const v = this.map.get(key);
    if (v !== void 0) {
      this.map.delete(key);
    }
    return v;
  }

  /**
   * @deprecated Use `take()` instead — values are already parsed.
   */
  takeParsed(key: string): unknown {
    return this.take(key);
  }

  tryTakeAny(keys: readonly string[]): { key: string; value: unknown } | null {
    for (const k of keys) {
      const v = this.take(k);
      if (v !== void 0) {
        return { key: k, value: v };
      }
    }
    return null;
  }

  takeByPrefix(prefix: string): Array<{ key: string; value: unknown }> {
    const results: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of this.map) {
      if (key.startsWith(prefix)) {
        results.push({ key, value });
        this.map.delete(key);
      }
    }
    return results;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  /** Whether any unconsumed key starts with `prefix` (no allocation). */
  hasByPrefix(prefix: string): boolean {
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  remaining(): CanonicalAttributes {
    return Object.fromEntries(this.map.entries());
  }
}

export class CanonicalEventStore {
  private readonly events: CanonicalEvent[];
  private readonly consumed = new Set<number>();

  private constructor(events: CanonicalEvent[]) {
    this.events = events;
  }

  static create(events: CanonicalEvent[]): CanonicalEventStore {
    return new CanonicalEventStore(events);
  }

  /** Read without consuming */
  all(): readonly CanonicalEvent[] {
    return this.events;
  }

  /** Take first event with this name (and mark it consumed) */
  tryTakeFirst(name: string): CanonicalEvent | null {
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      const event = this.events[i];
      if (event?.name === name) {
        this.consumed.add(i);
        return event;
      }
    }
    return null;
  }

  /** Take all events with this name (and mark consumed) */
  takeAll(name: string): CanonicalEvent[] {
    const out: CanonicalEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      const event = this.events[i];
      if (event?.name === name) {
        this.consumed.add(i);
        out.push(event);
      }
    }
    return out;
  }

  /** Take all events matching any of the given names, preserving original order */
  takeAllByNames(names: readonly string[]): CanonicalEvent[] {
    const nameSet = new Set(names);
    const out: CanonicalEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      if (this.consumed.has(i)) continue;
      const event = this.events[i];
      if (event !== void 0 && nameSet.has(event.name)) {
        this.consumed.add(i);
        out.push(event);
      }
    }
    return out;
  }

  /** Events that remain after consumption */
  remaining(): CanonicalEvent[] {
    const out: CanonicalEvent[] = [];
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      if (!this.consumed.has(i) && event !== void 0) out.push(event);
    }
    return out;
  }
}

export class CanonicalSpanStore {
  readonly attrs: CanonicalAttributeStore;
  readonly events: CanonicalEventStore;

  private constructor(spanAttributes: CanonicalAttributes, events: CanonicalEvent[]) {
    this.attrs = CanonicalAttributeStore.create(spanAttributes);
    this.events = CanonicalEventStore.create(events);
  }

  static create(args: {
    spanAttributes: CanonicalAttributes;
    events: CanonicalEvent[];
  }): CanonicalSpanStore {
    return new CanonicalSpanStore(args.spanAttributes, args.events);
  }
}

/**
 * Mirror of CanonicalSpanStore for log records. Wraps the log record's
 * attribute map so the canonical extractor pipeline can claim
 * (`take`) keys the same way it does for spans. Log records don't
 * carry their own event array (their `body` is the only narrative
 * field, and `attributes` already carries everything an extractor
 * needs), so this bag is a thin CanonicalAttributeStore wrapper plus the
 * scope name + body, which extractors gate detection on.
 */
export class CanonicalLogRecordStore {
  readonly attrs: CanonicalAttributeStore;

  private constructor(
    public readonly scopeName: string,
    public readonly body: string,
    attributes: CanonicalAttributes,
  ) {
    this.attrs = CanonicalAttributeStore.create(attributes);
  }

  static create(args: {
    scopeName: string;
    body: string;
    attributes: CanonicalAttributes;
  }): CanonicalLogRecordStore {
    return new CanonicalLogRecordStore(args.scopeName, args.body, args.attributes);
  }
}

import type {
  CanonicalAttributes,
  CanonicalEvent,
  CanonicalSpanContext,
} from "@langwatch/trace-contract";

/** A span's or log's attributes an extractor has not consumed yet, by key. */
export type CanonicalAttributeStore = Map<string, unknown>;

/** A span's events, and which of them an extractor has consumed. */
type CanonicalEventStore = {
  readonly events: readonly CanonicalEvent[];
  readonly consumed: Set<number>;
};

type CanonicalSpanStore = {
  readonly attrs: CanonicalAttributeStore;
  readonly events: CanonicalEventStore;
};

/**
 * A log record for canonical extraction; its scope and body gate the detectors.
 * Log records carry no events, so extractors gate on body and attributes alone.
 */
export type CanonicalLogRecordStore = {
  readonly scopeName: string;
  readonly body: string;
  readonly attrs: CanonicalAttributeStore;
};

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

/** One source's canonicalisation: a span pass, and an optional, independent log pass. */
export type AttributeCanonicaliser = {
  readonly id: string;
  /** Span canonicalisation. Extractors consume owned bag values and record rules. */
  apply(ctx: ExtractorContext): void;
  applyLog?(ctx: LogExtractorContext): void;
};

export function canonicalAttributeStore(input: CanonicalAttributes): CanonicalAttributeStore {
  return new Map(Object.entries(input));
}

export function canonicalSpanStore({
  spanAttributes,
  events,
}: {
  spanAttributes: CanonicalAttributes;
  events: CanonicalEvent[];
}): CanonicalSpanStore {
  return {
    attrs: canonicalAttributeStore(spanAttributes),
    events: { events, consumed: new Set() },
  };
}

export function canonicalLogRecordStore({
  scopeName,
  body,
  attributes,
}: {
  scopeName: string;
  body: string;
  attributes: CanonicalAttributes;
}): CanonicalLogRecordStore {
  return { scopeName, body, attrs: canonicalAttributeStore(attributes) };
}

/** Reads one attribute and consumes it. */
export function takeAttribute(attrs: CanonicalAttributeStore, key: string): unknown {
  const value = attrs.get(key);
  if (value !== void 0) attrs.delete(key);
  return value;
}

/** Consumes every attribute whose key starts with `prefix`. */
export function takeAttributesByPrefix(
  attrs: CanonicalAttributeStore,
  prefix: string,
): { key: string; value: unknown }[] {
  const results: { key: string; value: unknown }[] = [];
  for (const [key, value] of attrs) {
    if (key.startsWith(prefix)) {
      results.push({ key, value });
      attrs.delete(key);
    }
  }
  return results;
}

/** Whether any unconsumed key starts with `prefix`. */
export function hasAttributeWithPrefix(attrs: CanonicalAttributeStore, prefix: string): boolean {
  for (const key of attrs.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function remainingAttributes(attrs: CanonicalAttributeStore): CanonicalAttributes {
  return Object.fromEntries(attrs.entries());
}

/** Consumes every unconsumed event with one of `names`, in their original order. */
export function takeEventsByNames(
  store: CanonicalEventStore,
  names: readonly string[],
): CanonicalEvent[] {
  const nameSet = new Set(names);
  const out: CanonicalEvent[] = [];
  store.events.forEach((event, index) => {
    if (!store.consumed.has(index) && nameSet.has(event.name)) {
      store.consumed.add(index);
      out.push(event);
    }
  });
  return out;
}

/** Consumes every unconsumed event with this name. */
export function takeEvents(store: CanonicalEventStore, name: string): CanonicalEvent[] {
  return takeEventsByNames(store, [name]);
}

export function remainingEvents(store: CanonicalEventStore): CanonicalEvent[] {
  return store.events.filter((_event, index) => !store.consumed.has(index));
}

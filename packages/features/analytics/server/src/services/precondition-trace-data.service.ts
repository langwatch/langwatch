import type { PreconditionTraceData } from "@langwatch/analytics-contract";
import type { DerivedTraceEvent, TraceSummaryData } from "@langwatch/trace-contract";

/**
 * The fold state a match was settled on, read as the trace a filter matches.
 *
 * Filters are written against a trace's own vocabulary — a user id, a label, a
 * span model, an event metric — and a fold state carries most of that flattened
 * into one attribute map. This is the projection back: one place that knows
 * which attribute key each field is spelled with, so a background process
 * confirming a match sees the same trace the interactive filter saw.
 *
 * The trace-level events list is NOT on the fold state. A caller that matches
 * event filters derives it from stored spans and passes it in; omitting it
 * leaves event fields unresolved, which the matcher then fails closed on rather
 * than skipping to pass.
 */
export class PreconditionTraceDataService {
  static create(): PreconditionTraceDataService {
    return new PreconditionTraceDataService();
  }

  private constructor() {}

  fromFoldState(input: {
    foldState: TraceSummaryData;
    events?: DerivedTraceEvent[] | null;
  }): PreconditionTraceData {
    const attrs = input.foldState.attributes ?? {};

    return {
      input: input.foldState.computedInput ?? null,
      output: input.foldState.computedOutput ?? null,
      origin: attrs["langwatch.origin"] ?? null,
      hasError: input.foldState.containsErrorStatus,
      userId: attrs["langwatch.user_id"] ?? null,
      threadId: attrs["gen_ai.conversation.id"] ?? null,
      customerId: attrs["langwatch.customer_id"] ?? null,
      labels: parseJsonArray(attrs["langwatch.labels"]),
      promptIds: parseJsonArray(attrs["langwatch.prompt_ids"]),
      topicId: input.foldState.topicId ?? null,
      subTopicId: input.foldState.subTopicId ?? null,
      spanModels: input.foldState.models.length > 0 ? input.foldState.models : null,
      customMetadata: extractCustomMetadata(attrs),
      annotationIds: input.foldState.annotationIds,
      events: buildPreconditionEvents(input.events),
    };
  }
}

function buildPreconditionEvents(
  events: DerivedTraceEvent[] | null | undefined,
): PreconditionTraceData["events"] {
  if (!events || events.length === 0) {
    return null;
  }

  return events.map((e) => {
    const metrics: Array<{ key: string; value: number }> = [];
    const eventDetails: Array<{ key: string; value: string }> = [];

    for (const [key, value] of Object.entries(e.attributes)) {
      if (key.startsWith("event.metrics.")) {
        const metricKey = key.slice("event.metrics.".length);
        const num = Number(value);
        if (metricKey && Number.isFinite(num)) {
          metrics.push({ key: metricKey, value: num });
        }
      } else if (key.startsWith("event.details.")) {
        const detailKey = key.slice("event.details.".length);
        if (detailKey) {
          eventDetails.push({ key: detailKey, value });
        }
      }
    }

    return {
      event_type: e.name,
      metrics,
      event_details: eventDetails,
    };
  });
}

function parseJsonArray(raw: string | undefined): string[] | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((l): l is string => typeof l === "string");
    }
  } catch {
    // Not valid JSON
  }

  return null;
}

const RESERVED_PREFIXES = ["langwatch.", "gen_ai.", "metadata.sdk_", "metadata.telemetry_"];
const RESERVED_KEYS = new Set([
  "metadata.thread_id",
  "metadata.user_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.prompt_ids",
  "metadata.topic_id",
  "metadata.subtopic_id",
]);

/**
 * Bare-key prefixes that are standard OTEL/system attributes, not custom metadata.
 * Only used when resolving bare (unprefixed) attribute keys.
 */
const BARE_KEY_EXCLUDED_PREFIXES = [
  "service.",
  "telemetry.",
  "http.",
  "rpc.",
  "db.",
  "net.",
  "host.",
  "os.",
  "process.",
  "container.",
  "k8s.",
  "cloud.",
  "faas.",
  "url.",
  "server.",
  "client.",
  "otel.",
];

function resolveCustomMetadataKey(key: string): {
  customKey: string;
  priority: number;
} | null {
  // Priority 3: canonical "metadata.{key}" (from Python SDK canonicalization)
  if (key.startsWith("metadata.")) {
    if (RESERVED_KEYS.has(key)) {
      return null;
    }

    if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) {
      return null;
    }

    const customKey = key.slice("metadata.".length);

    return customKey ? { customKey, priority: 3 } : null;
  }

  // Priority 2: legacy "langwatch.metadata.{key}" (legacy REST collector)
  if (key.startsWith("langwatch.metadata.")) {
    const customKey = key.slice("langwatch.metadata.".length);

    return customKey ? { customKey, priority: 2 } : null;
  }

  // Skip all other known prefixes
  if (RESERVED_PREFIXES.some((p) => key.startsWith(p))) {
    return null;
  }

  if (BARE_KEY_EXCLUDED_PREFIXES.some((p) => key.startsWith(p))) {
    return null;
  }

  // Priority 1: bare OTEL resource attribute (legacy)
  if (key.length === 0) {
    return null;
  }

  return { customKey: key, priority: 1 };
}

/**
 * Extracts custom metadata from fold state attributes.
 * Matches all three legacy key formats consistent with ClickHouse filter generation:
 * - metadata.{key} (canonical, priority 3)
 * - langwatch.metadata.{key} (legacy REST, priority 2)
 * - {key} (bare OTEL attribute, priority 1)
 */
function extractCustomMetadata(attrs: Record<string, string>): Record<string, string> | null {
  const result: Record<string, string> = {};
  const priorities: Record<string, number> = {};

  for (const [key, value] of Object.entries(attrs)) {
    const resolved = resolveCustomMetadataKey(key);
    if (!resolved) {
      continue;
    }

    const currentPriority = priorities[resolved.customKey] ?? 0;
    if (resolved.priority <= currentPriority) {
      continue;
    }

    priorities[resolved.customKey] = resolved.priority;
    result[resolved.customKey] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}

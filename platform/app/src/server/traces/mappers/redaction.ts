import {
  redactSpanContent,
  redactTraceContent,
} from "~/server/app-layer/traces/visibility-window.service";
import { PRIVACY_DROPPED_MARKER_ATTR } from "~/server/data-privacy/dropKeyCatalog";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import type {
  Event,
  Span,
  SpanInputOutput,
  SpanMetrics,
  Trace,
  TraceInput,
  TraceOutput,
} from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { parsePythonInsideJson } from "~/utils/parsePythonInsideJson";
import { redactHiddenAttributes } from "./redactAttributes";

// Stable display order for the content categories a drop policy can strip, so
// the trace-view marker always lists them the same way ("input, output").
const DROP_CATEGORY_ORDER = ["input", "output", "system", "tools"];

/**
 * Reads the drop marker that `stripOtlpSpanContent` stamps on a span when a
 * `drop` privacy policy is active, listing the content categories it removed.
 * The span mapper unflattens dotted attribute keys into nested objects, so the
 * `langwatch.privacy.dropped` attribute arrives at the matching nested path
 * inside `span.params` rather than as a flat key.
 */
function readSpanDropMarker(span: Span): string[] {
  let node: unknown = span.params;
  for (const key of PRIVACY_DROPPED_MARKER_ATTR.split(".")) {
    if (typeof node !== "object" || node === null) return [];
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== "string") return [];
  return node
    .split(",")
    .map((category) => category.trim())
    .filter(Boolean);
}

/**
 * Collects the union of content categories any span reports as dropped by a
 * `drop` privacy policy, in a stable order, so the trace view can explain the
 * absence instead of rendering a blank that looks like missing instrumentation.
 */
export function collectDroppedCategories(spans: Span[] | undefined): string[] {
  const found = new Set<string>();
  for (const span of spans ?? []) {
    for (const category of readSpanDropMarker(span)) found.add(category);
  }
  return [
    ...DROP_CATEGORY_ORDER.filter((category) => found.has(category)),
    ...[...found].filter((category) => !DROP_CATEGORY_ORDER.includes(category)),
  ];
}

/**
 * String-value branch of {@link extractRedactionsForObject}: recurses into
 * JSON, then Python-repr, and finally falls back to the raw string itself.
 */
function extractRedactionsForString(value: string): string[] {
  try {
    const json = JSON.parse(value) as unknown;
    return extractRedactionsForObject(json);
  } catch {
    // Try parsing as Python repr - only if it looks like an object
    try {
      const json_ = parsePythonInsideJson({ value });
      if (typeof json_.value === "object" && json_.value !== null) {
        return extractRedactionsForObject(json_.value);
      }
    } catch {
      // Not valid Python repr either
    }
    return [value];
  }
}

/**
 * Extracts string values from an object for redaction purposes.
 * When input/output is not visible, we need to collect all string values
 * so they can be redacted from any visible fields.
 *
 * @param object - The object to extract redaction strings from
 * @returns Array of strings that should be redacted
 */
export function extractRedactionsForObject(object: unknown): string[] {
  if (typeof object === "string") {
    return extractRedactionsForString(object);
  }
  if (Array.isArray(object)) {
    return object.flatMap(extractRedactionsForObject);
  }
  if (typeof object === "object" && object !== null) {
    return Object.values(object).flatMap(extractRedactionsForObject);
  }

  return [];
}

/**
 * String-value branch of {@link redactObject}: recurses into JSON, then
 * Python-repr, and finally falls back to blanket-redacting the raw string
 * when it contains any redaction target.
 */
function redactStringValue(value: string, redactions: Set<string>): string {
  try {
    const json = JSON.parse(value) as unknown;
    return JSON.stringify(redactObject(json, redactions));
  } catch {
    // Try parsing as Python repr - only if it looks like an object
    try {
      const json_ = parsePythonInsideJson({ value });
      if (typeof json_.value === "object" && json_.value !== null) {
        return JSON.stringify(redactObject(json_.value, redactions));
      }
    } catch {
      // Not valid Python repr either
    }
    return Array.from(redactions).filter((redaction) =>
      value.includes(redaction),
    ).length > 0
      ? "[REDACTED]"
      : value;
  }
}

/**
 * Redacts sensitive values from an object.
 *
 * @param object - The object to redact
 * @param redactions - Set of strings that should be replaced with [REDACTED]
 * @returns The redacted object
 */
export function redactObject<T>(object: T, redactions: Set<string>): T {
  if (redactions.size === 0) {
    return object;
  }
  if (typeof object === "string") {
    return redactStringValue(object, redactions) as T;
  }
  if (Array.isArray(object)) {
    return object.map((item) => redactObject(item, redactions)) as T;
  }
  if (typeof object === "object" && object !== null) {
    return Object.fromEntries(
      Object.entries(object).map(([key, value]) => [
        key,
        redactObject(value, redactions),
      ]),
    ) as T;
  }
  return object;
}

/**
 * Extracts redaction strings from all span inputs.
 *
 * @param spans - Array of spans to extract input redactions from
 * @returns Array of strings that should be redacted
 */
export function extractRedactionsFromAllSpanInputs(spans: Span[]): string[] {
  return spans.flatMap((span) => extractRedactionsForObject(span.input?.value));
}

/**
 * Extracts redaction strings from all span outputs.
 *
 * @param spans - Array of spans to extract output redactions from
 * @returns Array of strings that should be redacted
 */
export function extractRedactionsFromAllSpanOutputs(spans: Span[]): string[] {
  return spans.flatMap((span) =>
    extractRedactionsForObject(span.output?.value),
  );
}

/** True when `startedAtMs` predates the plan's visibility window. */
function isBeyondVisibilityCutoff({
  protections,
  startedAtMs,
}: {
  protections: Protections;
  startedAtMs: number;
}): boolean {
  return (
    protections.visibilityCutoffMs !== null &&
    protections.visibilityCutoffMs !== undefined &&
    startedAtMs < protections.visibilityCutoffMs
  );
}

/** Redact span input if not allowed to see. */
function redactSpanInput({
  input,
  protections,
  redactions,
}: {
  input: SpanInputOutput | null | undefined;
  protections: Protections;
  redactions: Set<string>;
}): SpanInputOutput | null | undefined {
  if (!input) return input;
  if (protections.canSeeCapturedInput !== true) {
    return { type: "text", value: "[REDACTED]" };
  }
  // Create a new object with redacted value
  const redactedValue = redactObject(input.value, redactions);
  return { ...input, value: redactedValue } as SpanInputOutput;
}

/** Redact span output if not allowed to see. */
function redactSpanOutput({
  output,
  protections,
  redactions,
}: {
  output: SpanInputOutput | null | undefined;
  protections: Protections;
  redactions: Set<string>;
}): SpanInputOutput | null | undefined {
  if (!output) return output;
  if (protections.canSeeCapturedOutput !== true) {
    return { type: "text", value: "[REDACTED]" };
  }
  // Create a new object with redacted value
  const redactedValue = redactObject(output.value, redactions);
  return { ...output, value: redactedValue } as SpanInputOutput;
}

/** Redact span cost if not allowed to see. */
function redactSpanMetrics({
  metrics,
  protections,
}: {
  metrics: SpanMetrics | null | undefined;
  protections: Protections;
}): SpanMetrics | null | undefined {
  if (!metrics) return metrics;
  const { cost, ...otherMetrics } = metrics;
  const transformedMetrics: SpanMetrics = otherMetrics;

  if (protections.canSeeCosts === true) {
    transformedMetrics.cost = cost;
  }
  return transformedMetrics;
}

/**
 * Applies redaction protections to a span.
 *
 * @param span - The span to apply protections to
 * @param protections - The protection settings
 * @param redactions - Set of strings to redact
 * @returns The span with protections applied
 */
export function applySpanProtections(
  span: Span,
  protections: Protections,
  redactions: Set<string>,
): Span {
  const transformedInput = redactSpanInput({
    input: span.input,
    protections,
    redactions,
  });
  const transformedOutput = redactSpanOutput({
    output: span.output,
    protections,
    redactions,
  });
  const transformedMetrics = redactSpanMetrics({
    metrics: span.metrics,
    protections,
  });

  // Custom attribute rules with a restrict disposition: replace matched span
  // params (the mapper unflattens dotted keys into nested objects, so the
  // matcher walks the nested paths) with the placeholder naming who can see
  // them. Hidden input/output content riding along inside params (e.g. the
  // raw gen_ai message attributes) is scrubbed by the redactions set.
  const transformedParams = redactObject(
    redactHiddenAttributes(
      span.params as Record<string, unknown> | null | undefined,
      protections.hiddenAttributes,
    ),
    redactions,
  );

  const transformed = {
    ...span,
    input: transformedInput,
    output: transformedOutput,
    metrics: transformedMetrics,
    params: transformedParams as Span["params"],
  };

  // Teaser-redact content of spans beyond the plan's visibility window
  if (
    isBeyondVisibilityCutoff({
      protections,
      startedAtMs: span.timestamps.started_at,
    })
  ) {
    return redactSpanContent(transformed);
  }

  return transformed;
}

/**
 * Applies redaction protections to an event.
 * Redacts event_details when input is not visible, preserving event_type,
 * metrics, and timestamps.
 */
export function applyEventProtections(
  event: Event,
  protections: Protections,
  redactions: Set<string>,
): Event {
  if (protections.canSeeCapturedInput !== true) {
    return {
      ...event,
      event_details: Object.fromEntries(
        Object.keys(event.event_details).map((key) => [key, "[REDACTED]"]),
      ),
    };
  }

  return {
    ...event,
    event_details: redactObject(event.event_details, redactions),
  };
}

/**
 * Applies redaction protections to the v2 derived trace events (the events
 * timeline / exceptions pane). Event attributes are captured content —
 * exception messages quote application state — so they are blanked entirely
 * for a viewer who cannot read content or when the event predates the plan's
 * visibility cutoff; otherwise the restricted-attribute rules apply. Used by
 * both the in-app `tracesV2.traceEvents` read and the shared-trace payload,
 * so the two surfaces can never drift apart.
 */
export function applyDerivedTraceEventProtections(
  events: DerivedTraceEvent[],
  protections: Protections,
): DerivedTraceEvent[] {
  const contentVisible = protections.canSeeCapturedInput === true;
  const cutoffMs = protections.visibilityCutoffMs;
  const blank = (attrs: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.keys(attrs).map((key) => [key, "[REDACTED]"]));
  return events.map((event) => {
    const beyondCutoff = cutoffMs != null && event.timestamp < cutoffMs;
    if (!contentVisible || beyondCutoff) {
      return { ...event, attributes: blank(event.attributes) };
    }
    return {
      ...event,
      attributes:
        redactHiddenAttributes(
          event.attributes,
          protections.hiddenAttributes,
        ) ?? event.attributes,
    };
  });
}

/**
 * Builds the redaction set from trace input/output (and, when not visible,
 * every span input/output) so hidden content can be scrubbed from any
 * visible field it also appears in.
 */
function buildTraceRedactions(
  trace: Trace,
  protections: Protections,
): Set<string> {
  let redactions = new Set<string>([
    ...(!protections.canSeeCapturedInput
      ? extractRedactionsForObject(trace.input?.value)
      : []),
    ...(!protections.canSeeCapturedOutput
      ? extractRedactionsForObject(trace.output?.value)
      : []),
  ]);

  if (!protections.canSeeCapturedInput && trace.spans) {
    redactions = new Set([
      ...redactions,
      ...extractRedactionsFromAllSpanInputs(trace.spans),
    ]);
  }
  if (!protections.canSeeCapturedOutput && trace.spans) {
    redactions = new Set([
      ...redactions,
      ...extractRedactionsFromAllSpanOutputs(trace.spans),
    ]);
  }

  return redactions;
}

/** Apply protections to trace input. */
function redactTraceInput({
  input,
  protections,
  redactions,
}: {
  input: TraceInput | undefined;
  protections: Protections;
  redactions: Set<string>;
}): TraceInput | undefined {
  if (!input) return input;
  if (protections.canSeeCapturedInput !== true) return void 0;
  return redactObject(input, redactions);
}

/** Apply protections to trace output. */
function redactTraceOutput({
  output,
  protections,
  redactions,
}: {
  output: TraceOutput | undefined;
  protections: Protections;
  redactions: Set<string>;
}): TraceOutput | undefined {
  if (!output) return output;
  if (protections.canSeeCapturedOutput !== true) return void 0;
  return redactObject(output, redactions);
}

/** Apply protections to trace-level metrics (cost). */
function redactTraceMetrics({
  metrics,
  protections,
}: {
  metrics: Trace["metrics"] | undefined;
  protections: Protections;
}): Trace["metrics"] | undefined {
  if (!metrics) return metrics;
  const { total_cost, ...otherMetrics } = metrics;
  const transformedMetrics: Trace["metrics"] = otherMetrics;

  if (protections.canSeeCosts === true) {
    transformedMetrics.total_cost = total_cost;
  }
  return transformedMetrics;
}

/**
 * Applies redaction protections to a trace and its spans.
 *
 * @param trace - The trace to apply protections to
 * @param protections - The protection settings
 * @returns The trace with protections applied
 */
export function applyTraceProtections(
  trace: Trace,
  protections: Protections,
): Trace {
  const redactions = buildTraceRedactions(trace, protections);

  const transformedInput = redactTraceInput({
    input: trace.input,
    protections,
    redactions,
  });
  const transformedOutput = redactTraceOutput({
    output: trace.output,
    protections,
    redactions,
  });
  const transformedMetrics = redactTraceMetrics({
    metrics: trace.metrics,
    protections,
  });

  // Apply protections to spans
  const transformedSpans = trace.spans?.map((span) =>
    applySpanProtections(span, protections, redactions),
  );

  // Apply protections to events
  const transformedEvents = trace.events?.map((event) =>
    applyEventProtections(event, protections, redactions),
  );

  // Surface which categories a drop policy stripped at ingestion so the view can
  // mark the absence. Read from the span marker (which follows the data), not
  // the project's current settings, so old traces are not mislabeled after a
  // rule changes.
  const droppedCategories = collectDroppedCategories(trace.spans);

  const transformed = {
    ...trace,
    input: transformedInput,
    output: transformedOutput,
    metrics: transformedMetrics,
    spans: transformedSpans,
    events: transformedEvents,
    ...(droppedCategories.length > 0
      ? { privacy: { ...trace.privacy, droppedCategories } }
      : {}),
  };

  // Teaser-redact content of traces beyond the plan's visibility window.
  // Spans were already age-checked and teased individually in
  // applySpanProtections — exclude them here so they are not double-teased;
  // this pass covers the trace-level content fields and stamps the redacted
  // flag for the upgrade CTA.
  if (
    isBeyondVisibilityCutoff({
      protections,
      startedAtMs: trace.timestamps.started_at,
    })
  ) {
    const { spans, ...traceWithoutSpans } = transformed;
    return {
      ...redactTraceContent({ ...traceWithoutSpans, spans: [] }),
      spans,
    };
  }

  return transformed;
}

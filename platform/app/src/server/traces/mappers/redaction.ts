import {
  redactSpanContent,
  redactTraceContent,
} from "~/server/app-layer/traces/visibility-window.service";
import { PRIVACY_DROPPED_MARKER_ATTR } from "~/server/data-privacy/dropKeyCatalog";
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
 * Extracts string values from an object for redaction purposes.
 * When input/output is not visible, we need to collect all string values
 * so they can be redacted from any visible fields.
 *
 * @param object - The object to extract redaction strings from
 * @returns Array of strings that should be redacted
 */
export function extractRedactionsForObject(object: unknown): string[] {
  if (typeof object === "string") {
    try {
      const json = JSON.parse(object) as unknown;
      return extractRedactionsForObject(json);
    } catch {
      // Try parsing as Python repr - only if it looks like an object
      try {
        const json_ = parsePythonInsideJson({ value: object });
        if (typeof json_.value === "object" && json_.value !== null) {
          return extractRedactionsForObject(json_.value);
        }
      } catch {
        // Not valid Python repr either
      }
      return [object];
    }
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
    try {
      const json = JSON.parse(object) as unknown;
      return JSON.stringify(redactObject(json, redactions)) as T;
    } catch {
      // Try parsing as Python repr - only if it looks like an object
      try {
        const json_ = parsePythonInsideJson({ value: object });
        if (typeof json_.value === "object" && json_.value !== null) {
          return JSON.stringify(redactObject(json_.value, redactions)) as T;
        }
      } catch {
        // Not valid Python repr either
      }
      return Array.from(redactions).filter((redaction) =>
        object.includes(redaction),
      ).length > 0
        ? ("[REDACTED]" as T)
        : object;
    }
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
  let transformedInput: SpanInputOutput | null | undefined = span.input;
  let transformedOutput: SpanInputOutput | null | undefined = span.output;
  let transformedMetrics: SpanMetrics | null | undefined = span.metrics;

  // Redact input if not allowed to see
  if (span.input) {
    if (protections.canSeeCapturedInput !== true) {
      transformedInput = { type: "text", value: "[REDACTED]" };
    } else {
      // Create a new object with redacted value
      const redactedValue = redactObject(span.input.value, redactions);
      transformedInput = {
        ...span.input,
        value: redactedValue,
      } as SpanInputOutput;
    }
  }

  // Redact output if not allowed to see
  if (span.output) {
    if (protections.canSeeCapturedOutput !== true) {
      transformedOutput = { type: "text", value: "[REDACTED]" };
    } else {
      // Create a new object with redacted value
      const redactedValue = redactObject(span.output.value, redactions);
      transformedOutput = {
        ...span.output,
        value: redactedValue,
      } as SpanInputOutput;
    }
  }

  // Redact cost if not allowed to see
  if (span.metrics) {
    const { cost, ...otherMetrics } = span.metrics;
    transformedMetrics = otherMetrics;

    if (protections.canSeeCosts === true) {
      transformedMetrics.cost = cost;
    }
  }

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
    protections.visibilityCutoffMs !== null &&
    protections.visibilityCutoffMs !== undefined &&
    span.timestamps.started_at < protections.visibilityCutoffMs
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
  // Build redaction set from trace input/output if not visible
  let redactions = new Set<string>([
    ...(!protections.canSeeCapturedInput
      ? extractRedactionsForObject(trace.input?.value)
      : []),
    ...(!protections.canSeeCapturedOutput
      ? extractRedactionsForObject(trace.output?.value)
      : []),
  ]);

  // Add span inputs/outputs to redactions if not visible
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

  // Apply protections to trace input
  let transformedInput: TraceInput | undefined = trace.input;
  if (trace.input) {
    if (protections.canSeeCapturedInput !== true) {
      transformedInput = void 0;
    } else {
      transformedInput = redactObject(trace.input, redactions);
    }
  }

  // Apply protections to trace output
  let transformedOutput: TraceOutput | undefined = trace.output;
  if (trace.output) {
    if (protections.canSeeCapturedOutput !== true) {
      transformedOutput = void 0;
    } else {
      transformedOutput = redactObject(trace.output, redactions);
    }
  }

  // Apply protections to metrics
  let transformedMetrics: Trace["metrics"] | undefined = trace.metrics;
  if (trace.metrics) {
    const { total_cost, ...otherMetrics } = trace.metrics;
    transformedMetrics = otherMetrics;

    if (protections.canSeeCosts === true) {
      transformedMetrics.total_cost = total_cost;
    }
  }

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
    protections.visibilityCutoffMs !== null &&
    protections.visibilityCutoffMs !== undefined &&
    trace.timestamps.started_at < protections.visibilityCutoffMs
  ) {
    const { spans, ...traceWithoutSpans } = transformed;
    return {
      ...redactTraceContent({ ...traceWithoutSpans, spans: [] }),
      spans,
    };
  }

  return transformed;
}

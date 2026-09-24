import { PRIVACY_DROPPED_MARKER_ATTR } from "@langwatch/data-privacy-contract";
import type {
  Protections,
  DerivedTraceEvent,
  Event,
  Span,
  SpanInputOutput,
  SpanMetrics,
  Trace,
} from "@langwatch/trace-contract";
import { parsePythonInsideJson } from "@langwatch/trace-contract";

import { TraceAttributeRedactionService } from "../services/trace-attribute-redaction.service.ts";
import { VisibilityWindowService } from "../services/trace-visibility-window.service.ts";

// Stable display order for the content categories a drop policy can strip, so
// the trace-view marker always lists them the same way ("input, output").
const DROP_CATEGORY_ORDER = ["input", "output", "system", "tools"];

/**
 * Reads the drop marker `stripOtlpSpanContent` stamps on a span under a `drop` privacy policy,
 * listing the content categories it removed. The span mapper unflattens dotted keys, so
 * `langwatch.privacy.dropped` arrives at the matching nested path inside `span.params`.
 */
function readSpanDropMarker(span: Span): string[] {
  let node: unknown = span.params;
  for (const key of PRIVACY_DROPPED_MARKER_ATTR.split(".")) {
    if (typeof node !== "object" || node === null) {
      return [];
    }

    node = (node as Record<string, unknown>)[key];
  }

  if (typeof node !== "string") {
    return [];
  }

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
    for (const category of readSpanDropMarker(span)) {
      found.add(category);
    }
  }

  return [
    ...DROP_CATEGORY_ORDER.filter((category) => found.has(category)),
    ...[...found].filter((category) => !DROP_CATEGORY_ORDER.includes(category)),
  ];
}

/** A string's redactions: its parsed JSON or Python-repr object's strings, else itself. */
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
      return [value];
    }

    return [value];
  }
}

/**
 * Every string value in an object, so that when input and output are not visible they can be
 * redacted out of the fields that are.
 */
export function extractRedactionsForObject(object: unknown): string[] {
  if (typeof object === "string") {
    return extractRedactionsForString(object);
  }

  if (Array.isArray(object)) {
    return object.flatMap((item) => extractRedactionsForObject(item));
  }

  if (typeof object === "object" && object !== null) {
    return Object.values(object).flatMap((value) => extractRedactionsForObject(value));
  }

  return [];
}

/**
 * A string value, redacted: parsed as JSON or Python repr so nested strings are
 * reached individually, and replaced wholesale when it merely contains a secret.
 */
function redactString(value: string, redactions: Set<string>): string {
  try {
    const json = JSON.parse(value) as unknown;

    return JSON.stringify(redactObject(json, redactions));
  } catch {
    return redactUnparsedString(value, redactions);
  }
}

/** A string that is not JSON: redacted as a Python repr when it is one, else wholesale. */
function redactUnparsedString(value: string, redactions: Set<string>): string {
  try {
    const parsed = parsePythonInsideJson({ value });
    const isObject = typeof parsed.value === "object" && parsed.value !== null;
    if (isObject) {
      return JSON.stringify(redactObject(parsed.value, redactions));
    }
  } catch {
    // Not valid Python repr either
  }

  const present = Array.from(redactions).filter((redaction) => value.includes(redaction));
  return present.length > 0 ? "[REDACTED]" : value;
}

/** Redacts sensitive values from an object. */
export const redactObject = <T>(object: T, redactions: Set<string>): T => {
  if (redactions.size === 0) {
    return object;
  }

  if (typeof object === "string") {
    return redactString(object, redactions) as T;
  }

  if (Array.isArray(object)) {
    return object.map((item) => redactObject(item, redactions)) as T;
  }

  if (typeof object === "object" && object !== null) {
    return Object.fromEntries(
      Object.entries(object).map(([key, value]) => [key, redactObject(value, redactions)]),
    ) as T;
  }

  return object;
};

/**
 * Extracts redaction strings from all span inputs.
 * @param spans - Array of spans to extract input redactions from
 * @returns Array of strings that should be redacted
 */
// Static arrow property — see redactObject above for why.
export const extractRedactionsFromAllSpanInputs = (spans: Span[]): string[] => {
  return spans.flatMap((span) => extractRedactionsForObject(span.input?.value));
};

/**
 * Extracts redaction strings from all span outputs.
 * @param spans - Array of spans to extract output redactions from
 * @returns Array of strings that should be redacted
 */
// Static arrow property — see redactObject above for why.
export const extractRedactionsFromAllSpanOutputs = (spans: Span[]): string[] => {
  return spans.flatMap((span) => extractRedactionsForObject(span.output?.value));
};

// Static arrow property — see redactObject above for why.
export const applySpanProtections = (
  span: Span,
  protections: Protections,
  redactions: Set<string>,
): Span => {
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
    TraceAttributeRedactionService.create(protections.hiddenAttributes).redact(
      span.params as Record<string, unknown> | null | undefined,
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
    return VisibilityWindowService.redactSpanContent(transformed);
  }

  return transformed;
};

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
 * Applies redaction protections to the derived trace events, blanking
 * attributes for a viewer who can't read content or is past the
 * visibility cutoff. Static arrow property — see redactObject above.
 */
export const applyDerivedTraceEventProtections = (
  events: DerivedTraceEvent[],
  protections: Protections,
): DerivedTraceEvent[] => {
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
        TraceAttributeRedactionService.create(protections.hiddenAttributes).redact(
          event.attributes,
        ) ?? event.attributes,
    };
  });
};

/**
 * Applies redaction protections to a trace and its spans, returning the trace as this viewer may
 * read it.
 */
export function applyTraceProtections(trace: Trace, protections: Protections): Trace {
  const redactions = collectTraceRedactions(trace, protections);
  const transformed = {
    ...trace,
    ...protectedContent(trace, protections, redactions),
    metrics: protectedMetrics(trace, protections),
    spans: trace.spans?.map((span) => applySpanProtections(span, protections, redactions)),
    events: trace.events?.map((event) => applyEventProtections(event, protections, redactions)),
    // Which categories a drop policy stripped at ingestion, so the view can mark the absence.
    // Read from the span marker, which follows the data, rather than the project's current
    // settings, so an old trace is not mislabeled after a rule changes.
    ...(collectDroppedCategories(trace.spans).length > 0
      ? {
          privacy: {
            ...trace.privacy,
            droppedCategories: collectDroppedCategories(trace.spans),
          },
        }
      : {}),
  };

  // Spans were already age-checked and teased individually, so they are held out of the
  // trace-level teaser pass rather than teased twice; that pass stamps the redacted flag.
  if (
    protections.visibilityCutoffMs !== null &&
    protections.visibilityCutoffMs !== undefined &&
    trace.timestamps.started_at < protections.visibilityCutoffMs
  ) {
    const { spans, ...traceWithoutSpans } = transformed;

    return {
      ...VisibilityWindowService.redactTraceContent({ ...traceWithoutSpans, spans: [] }),
      spans,
    };
  }

  return transformed;
}

/**
 * Every string a viewer may not read, gathered from the trace's own content and its spans', so
 * that a value hidden in one place cannot come back through a field that is visible.
 */
function collectTraceRedactions(trace: Trace, protections: Protections): Set<string> {
  const redactions = new Set<string>([
    ...(!protections.canSeeCapturedInput ? extractRedactionsForObject(trace.input?.value) : []),
    ...(!protections.canSeeCapturedOutput ? extractRedactionsForObject(trace.output?.value) : []),
  ]);
  if (!trace.spans) {
    return redactions;
  }

  if (!protections.canSeeCapturedInput) {
    for (const value of extractRedactionsFromAllSpanInputs(trace.spans)) {
      redactions.add(value);
    }
  }

  if (!protections.canSeeCapturedOutput) {
    for (const value of extractRedactionsFromAllSpanOutputs(trace.spans)) {
      redactions.add(value);
    }
  }

  return redactions;
}

/** The content fields: each dropped when its category is hidden, redacted when it is not. */
function protectedContent(
  trace: Trace,
  protections: Protections,
  redactions: Set<string>,
): Pick<Trace, "input" | "output"> {
  return {
    input:
      trace.input &&
      (protections.canSeeCapturedInput === true ? redactObject(trace.input, redactions) : void 0),
    output:
      trace.output &&
      (protections.canSeeCapturedOutput === true ? redactObject(trace.output, redactions) : void 0),
  };
}

/** The trace's metrics, with cost present only for a viewer who may read costs. */
function protectedMetrics(trace: Trace, protections: Protections): Trace["metrics"] {
  if (!trace.metrics) {
    return trace.metrics;
  }

  const { total_cost, ...otherMetrics } = trace.metrics;

  return protections.canSeeCosts === true ? { ...otherMetrics, total_cost } : otherMetrics;
}

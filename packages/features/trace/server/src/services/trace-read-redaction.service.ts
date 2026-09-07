import type { Protections } from "@langwatch/trace-contract";
import { VisibilityWindowService } from "./trace-visibility-window.service.ts";
import { PRIVACY_DROPPED_MARKER_ATTR } from "@langwatch/data-privacy-contract";
import type { DerivedTraceEvent } from "@langwatch/trace-contract";
import type {
  Event,
  Span,
  SpanInputOutput,
  SpanMetrics,
  Trace,
  TraceInput,
  TraceOutput,
} from "@langwatch/trace-contract";
import { TraceAttributeRedactionService } from "@langwatch/trace-server";
import { parsePythonInsideJson } from "@langwatch/trace-contract";

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

export class TraceReadRedactionService {
  static create(): TraceReadRedactionService {
    return new TraceReadRedactionService();
  }

  /**
   * Collects the union of content categories any span reports as dropped by a
   * `drop` privacy policy, in a stable order, so the trace view can explain the
   * absence instead of rendering a blank that looks like missing instrumentation.
   */
  static collectDroppedCategories(spans: Span[] | undefined): string[] {
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

  /**
   * Every string value in an object, so that when input and output are not visible they can be
   * redacted out of the fields that are.
   */
  static extractRedactionsForObject(object: unknown): string[] {
    if (typeof object === "string") {
      try {
        const json = JSON.parse(object) as unknown;

        return TraceReadRedactionService.extractRedactionsForObject(json);
      } catch {
        // Try parsing as Python repr - only if it looks like an object
        try {
          const json_ = parsePythonInsideJson({ value: object });
          if (typeof json_.value === "object" && json_.value !== null) {
            return TraceReadRedactionService.extractRedactionsForObject(json_.value);
          }
        } catch {
          // Not valid Python repr either
        }

        return [object];
      }
    }

    if (Array.isArray(object)) {
      return object.flatMap(TraceReadRedactionService.extractRedactionsForObject);
    }

    if (typeof object === "object" && object !== null) {
      return Object.values(object).flatMap(TraceReadRedactionService.extractRedactionsForObject);
    }

    return [];
  }

  /**
   * A string value, redacted: parsed as JSON or Python repr so nested strings are
   * reached individually, and replaced wholesale when it merely contains a secret.
   */
  private static redactString(value: string, redactions: Set<string>): string {
    try {
      const json = JSON.parse(value) as unknown;

      return JSON.stringify(TraceReadRedactionService.redactObject(json, redactions));
    } catch {
      const fromPython = TraceReadRedactionService.redactPythonRepr(value, redactions);
      if (fromPython !== null) {
        return fromPython;
      }

      const present = Array.from(redactions).filter((redaction) => value.includes(redaction));

      return present.length > 0 ? "[REDACTED]" : value;
    }
  }

  /** The same for a Python repr, or null when the value is not one. */
  private static redactPythonRepr(value: string, redactions: Set<string>): string | null {
    try {
      const parsed = parsePythonInsideJson({ value });
      const isObject = typeof parsed.value === "object" && parsed.value !== null;
      if (isObject) {
        return JSON.stringify(TraceReadRedactionService.redactObject(parsed.value, redactions));
      }
    } catch {
      // Not valid Python repr either
    }

    return null;
  }

  /** Redacts sensitive values from an object. */
  static redactObject<T>(object: T, redactions: Set<string>): T {
    if (redactions.size === 0) {
      return object;
    }

    if (typeof object === "string") {
      return TraceReadRedactionService.redactString(object, redactions) as T;
    }

    if (Array.isArray(object)) {
      return object.map((item) => TraceReadRedactionService.redactObject(item, redactions)) as T;
    }

    if (typeof object === "object" && object !== null) {
      return Object.fromEntries(
        Object.entries(object).map(([key, value]) => [
          key,
          TraceReadRedactionService.redactObject(value, redactions),
        ]),
      ) as T;
    }

    return object;
  }

  /**
   * Extracts redaction strings from all span inputs.
   * @param spans - Array of spans to extract input redactions from
   * @returns Array of strings that should be redacted
   */
  static extractRedactionsFromAllSpanInputs(spans: Span[]): string[] {
    return spans.flatMap((span) =>
      TraceReadRedactionService.extractRedactionsForObject(span.input?.value),
    );
  }

  /**
   * Extracts redaction strings from all span outputs.
   * @param spans - Array of spans to extract output redactions from
   * @returns Array of strings that should be redacted
   */
  static extractRedactionsFromAllSpanOutputs(spans: Span[]): string[] {
    return spans.flatMap((span) =>
      TraceReadRedactionService.extractRedactionsForObject(span.output?.value),
    );
  }

  /** Applies redaction protections to a span. */
  static applySpanProtections(span: Span, protections: Protections, redactions: Set<string>): Span {
    let transformedInput: SpanInputOutput | null | undefined = span.input;
    let transformedOutput: SpanInputOutput | null | undefined = span.output;
    let transformedMetrics: SpanMetrics | null | undefined = span.metrics;

    // Redact input if not allowed to see
    if (span.input) {
      if (protections.canSeeCapturedInput !== true) {
        transformedInput = { type: "text", value: "[REDACTED]" };
      } else {
        // Create a new object with redacted value
        const redactedValue = TraceReadRedactionService.redactObject(span.input.value, redactions);
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
        const redactedValue = TraceReadRedactionService.redactObject(span.output.value, redactions);
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
    const transformedParams = TraceReadRedactionService.redactObject(
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
  }

  /**
   * Applies redaction protections to an event.
   * Redacts event_details when input is not visible, preserving event_type,
   * metrics, and timestamps.
   */
  static applyEventProtections(
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
      event_details: TraceReadRedactionService.redactObject(event.event_details, redactions),
    };
  }

  /**
   * Applies redaction protections to the derived trace events. Event attributes are captured
   * content — exception messages quote application state — so they are blanked for a viewer who
   * cannot read content or past the visibility cutoff; otherwise restricted-attribute rules apply.
   */
  static applyDerivedTraceEventProtections(
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
          TraceAttributeRedactionService.create(protections.hiddenAttributes).redact(
            event.attributes,
          ) ?? event.attributes,
      };
    });
  }

  /**
   * Applies redaction protections to a trace and its spans, returning the trace as this viewer may
   * read it.
   */
  static applyTraceProtections(trace: Trace, protections: Protections): Trace {
    const redactions = TraceReadRedactionService.collectTraceRedactions(trace, protections);
    const transformed = {
      ...trace,
      input: TraceReadRedactionService.protectedValue({
        value: trace.input,
        visible: protections.canSeeCapturedInput === true,
        redactions,
      }),
      output: TraceReadRedactionService.protectedValue({
        value: trace.output,
        visible: protections.canSeeCapturedOutput === true,
        redactions,
      }),
      metrics: TraceReadRedactionService.protectedMetrics(trace, protections),
      spans: trace.spans?.map((span) =>
        TraceReadRedactionService.applySpanProtections(span, protections, redactions),
      ),
      events: trace.events?.map((event) =>
        TraceReadRedactionService.applyEventProtections(event, protections, redactions),
      ),
      // Which categories a drop policy stripped at ingestion, so the view can mark the absence.
      // Read from the span marker, which follows the data, rather than the project's current
      // settings, so an old trace is not mislabeled after a rule changes.
      ...(TraceReadRedactionService.collectDroppedCategories(trace.spans).length > 0
        ? {
            privacy: {
              ...trace.privacy,
              droppedCategories: TraceReadRedactionService.collectDroppedCategories(trace.spans),
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
  private static collectTraceRedactions(trace: Trace, protections: Protections): Set<string> {
    const redactions = new Set<string>([
      ...(!protections.canSeeCapturedInput
        ? TraceReadRedactionService.extractRedactionsForObject(trace.input?.value)
        : []),
      ...(!protections.canSeeCapturedOutput
        ? TraceReadRedactionService.extractRedactionsForObject(trace.output?.value)
        : []),
    ]);
    if (!trace.spans) {
      return redactions;
    }

    if (!protections.canSeeCapturedInput) {
      for (const value of TraceReadRedactionService.extractRedactionsFromAllSpanInputs(
        trace.spans,
      )) {
        redactions.add(value);
      }
    }

    if (!protections.canSeeCapturedOutput) {
      for (const value of TraceReadRedactionService.extractRedactionsFromAllSpanOutputs(
        trace.spans,
      )) {
        redactions.add(value);
      }
    }

    return redactions;
  }

  /** One content field: dropped entirely when the category is hidden, redacted when it is not. */
  private static protectedValue<T extends TraceInput | TraceOutput>({
    value,
    visible,
    redactions,
  }: {
    value: T | undefined;
    visible: boolean;
    redactions: Set<string>;
  }): T | undefined {
    if (!value) {
      return value;
    }

    return visible ? TraceReadRedactionService.redactObject(value, redactions) : void 0;
  }

  /** The trace's metrics, with cost present only for a viewer who may read costs. */
  private static protectedMetrics(trace: Trace, protections: Protections): Trace["metrics"] {
    if (!trace.metrics) {
      return trace.metrics;
    }

    const { total_cost, ...otherMetrics } = trace.metrics;

    return protections.canSeeCosts === true ? { ...otherMetrics, total_cost } : otherMetrics;
  }
}

import type { Protections } from "@langwatch/trace-contract";
import { VisibilityWindowService } from "./trace-visibility-window.service";
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
 * Reads the drop marker that `stripOtlpSpanContent` stamps on a span when a `drop` privacy policy is active, listing content categories it removed. The span mapper unflattens dotted attribute keys into nested objects, so `langwatch.privacy.dropped` arrives at the matching nested path inside `span.params` rather than as a flat key.
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
   * Extracts string values from an object for redaction: when input/output is not visible, all string values must be collected so they can be redacted from any visible fields.
   * @param object - The object to extract redaction strings from
   * @returns Array of strings that should be redacted
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
   * Redacts sensitive values from an object.
   * @param object - The object to redact; @param redactions - Set of strings to replace with [REDACTED]
   * @returns The redacted object
   */
  static redactObject<T>(object: T, redactions: Set<string>): T {
    if (redactions.size === 0) {
      return object;
    }

    if (typeof object === "string") {
      try {
        const json = JSON.parse(object) as unknown;

        return JSON.stringify(TraceReadRedactionService.redactObject(json, redactions)) as T;
      } catch {
        // Try parsing as Python repr - only if it looks like an object
        try {
          const json_ = parsePythonInsideJson({ value: object });
          if (typeof json_.value === "object" && json_.value !== null) {
            return JSON.stringify(
              TraceReadRedactionService.redactObject(json_.value, redactions),
            ) as T;
          }
        } catch {
          // Not valid Python repr either
        }

        return Array.from(redactions).filter((redaction) => object.includes(redaction)).length > 0
          ? ("[REDACTED]" as T)
          : object;
      }
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

  /**
   * Applies redaction protections to a span.
   * @param span/protections/redactions - Span to protect, protection settings, and strings to redact
   * @returns The span with protections applied
   */
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
   * Applies redaction protections to the v2 derived trace events (events timeline / exceptions pane). Event attributes are captured content — exception messages quote application state — so they are blanked entirely for a viewer who cannot read content or when the event predates the plan's visibility cutoff; otherwise the restricted-attribute rules apply. Used by both the in-app `tracesV2.traceEvents` read and the shared-trace payload, so the two surfaces can never drift apart.
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
   * Applies redaction protections to a trace and its spans.
   * @param trace/protections - Trace to apply protections to, and the protection settings
   * @returns The trace with protections applied
   */
  static applyTraceProtections(trace: Trace, protections: Protections): Trace {
    // Build redaction set from trace input/output if not visible
    let redactions = new Set<string>([
      ...(!protections.canSeeCapturedInput
        ? TraceReadRedactionService.extractRedactionsForObject(trace.input?.value)
        : []),
      ...(!protections.canSeeCapturedOutput
        ? TraceReadRedactionService.extractRedactionsForObject(trace.output?.value)
        : []),
    ]);

    // Add span inputs/outputs to redactions if not visible
    if (!protections.canSeeCapturedInput && trace.spans) {
      redactions = new Set([
        ...redactions,
        ...TraceReadRedactionService.extractRedactionsFromAllSpanInputs(trace.spans),
      ]);
    }

    if (!protections.canSeeCapturedOutput && trace.spans) {
      redactions = new Set([
        ...redactions,
        ...TraceReadRedactionService.extractRedactionsFromAllSpanOutputs(trace.spans),
      ]);
    }

    // Apply protections to trace input
    let transformedInput: TraceInput | undefined = trace.input;
    if (trace.input) {
      if (protections.canSeeCapturedInput !== true) {
        transformedInput = void 0;
      } else {
        transformedInput = TraceReadRedactionService.redactObject(trace.input, redactions);
      }
    }

    // Apply protections to trace output
    let transformedOutput: TraceOutput | undefined = trace.output;
    if (trace.output) {
      if (protections.canSeeCapturedOutput !== true) {
        transformedOutput = void 0;
      } else {
        transformedOutput = TraceReadRedactionService.redactObject(trace.output, redactions);
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
      TraceReadRedactionService.applySpanProtections(span, protections, redactions),
    );

    // Apply protections to events
    const transformedEvents = trace.events?.map((event) =>
      TraceReadRedactionService.applyEventProtections(event, protections, redactions),
    );

    // Surface which categories a drop policy stripped at ingestion so the view can
    // mark the absence. Read from the span marker (which follows the data), not
    // the project's current settings, so old traces are not mislabeled after a
    // rule changes.
    const droppedCategories = TraceReadRedactionService.collectDroppedCategories(trace.spans);

    const transformed = {
      ...trace,
      input: transformedInput,
      output: transformedOutput,
      metrics: transformedMetrics,
      spans: transformedSpans,
      events: transformedEvents,
      ...(droppedCategories.length > 0 ? { privacy: { ...trace.privacy, droppedCategories } } : {}),
    };

    // Teaser-redact content of traces beyond the plan's visibility window.
    // Spans were already age-checked and teased individually in
    // TraceReadRedactionService.applySpanProtections — exclude them here so they are not double-teased;
    // this pass covers the trace-level content fields and stamps the redacted
    // flag for the upgrade CTA.
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
}

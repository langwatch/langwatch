import type { Protections } from "~/server/elasticsearch/protections";
import type { Span, SpanInputOutput, SpanMetrics, Trace, TraceInput, TraceOutput } from "~/server/tracer/types";
import { parsePythonInsideJson } from "~/utils/parsePythonInsideJson";

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
        object.includes(redaction)
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
      ])
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
  return spans.flatMap((span) =>
    extractRedactionsForObject(span.input?.value)
  );
}

/**
 * Extracts redaction strings from all span outputs.
 *
 * @param spans - Array of spans to extract output redactions from
 * @returns Array of strings that should be redacted
 */
export function extractRedactionsFromAllSpanOutputs(spans: Span[]): string[] {
  return spans.flatMap((span) =>
    extractRedactionsForObject(span.output?.value)
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
  redactions: Set<string>
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

  return {
    ...span,
    input: transformedInput,
    output: transformedOutput,
    metrics: transformedMetrics,
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
  protections: Protections
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
    applySpanProtections(span, protections, redactions)
  );

  return {
    ...trace,
    input: transformedInput,
    output: transformedOutput,
    metrics: transformedMetrics,
    spans: transformedSpans,
  };
}

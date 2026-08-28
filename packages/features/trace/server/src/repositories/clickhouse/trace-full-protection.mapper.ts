import type {
  TraceFullRecord,
  TraceFullRecordEvent,
  TraceFullRecordSpan,
  TraceRecordValue,
} from "@langwatch/trace-contract";

/**
 * Read-time content policy for a full Trace capture. Public adapters derive it
 * from the actor; internal process reads use the explicit all-visible policy.
 */
export type TraceFullReadProtections = {
  canSeeCapturedInput: boolean;
  canSeeCapturedOutput: boolean;
  canSeeCosts: boolean;
};

/** Internal Evaluation/process reads are trusted and intentionally all-visible. */
export const internalTraceFullReadProtections: TraceFullReadProtections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/**
 * Applies the capture/cost portions of the established Trace protection policy
 * after a full record has been assembled. The rule is actor-independent; a
 * later public adapter supplies viewer-derived protections at this boundary.
 */
export function applyTraceFullRecordProtections(
  trace: TraceFullRecord,
  protections: TraceFullReadProtections,
): TraceFullRecord {
  const redactions = new Set<string>();
  if (!protections.canSeeCapturedInput) {
    collectStrings(trace.input?.value, redactions);
    for (const span of trace.spans) collectStrings(span.input?.value, redactions);
  }
  if (!protections.canSeeCapturedOutput) {
    collectStrings(trace.output?.value, redactions);
    for (const span of trace.spans) collectStrings(span.output?.value, redactions);
  }

  const spans = trace.spans.map((span) => protectSpan(span, protections, redactions));
  const events = trace.events?.map((event) => protectEvent(event, protections, redactions));
  const metrics = protectMetrics(trace.metrics, protections.canSeeCosts);
  const input = protections.canSeeCapturedInput ? protectContent(trace.input, redactions) : void 0;
  const output = protections.canSeeCapturedOutput
    ? protectContent(trace.output, redactions)
    : void 0;

  return {
    ...trace,
    ...(input === void 0 ? {} : { input }),
    ...(output === void 0 ? {} : { output }),
    ...(trace.input !== void 0 && input === void 0 ? { input: void 0 } : {}),
    ...(trace.output !== void 0 && output === void 0 ? { output: void 0 } : {}),
    ...(metrics === void 0 ? {} : { metrics }),
    spans,
    ...(events === void 0 ? {} : { events }),
  };
}

function protectSpan(
  span: TraceFullRecordSpan,
  protections: TraceFullReadProtections,
  redactions: Set<string>,
): TraceFullRecordSpan {
  return {
    ...span,
    ...(span.input === void 0 || span.input === null
      ? {}
      : {
          input: protections.canSeeCapturedInput
            ? protectContent(span.input, redactions)
            : { type: "text", value: "[REDACTED]" },
        }),
    ...(span.output === void 0 || span.output === null
      ? {}
      : {
          output: protections.canSeeCapturedOutput
            ? protectContent(span.output, redactions)
            : { type: "text", value: "[REDACTED]" },
        }),
    ...(span.params === void 0 || span.params === null
      ? {}
      : { params: redactRecord(span.params, redactions) }),
    ...(span.metrics === void 0 || span.metrics === null
      ? {}
      : { metrics: protectMetrics(span.metrics, protections.canSeeCosts) }),
  };
}

function protectEvent(
  event: TraceFullRecordEvent,
  protections: TraceFullReadProtections,
  redactions: Set<string>,
): TraceFullRecordEvent {
  if (!protections.canSeeCapturedInput) {
    return {
      ...event,
      event_details: Object.fromEntries(
        Object.keys(event.event_details).map((key) => [key, "[REDACTED]"]),
      ),
    };
  }
  return { ...event, event_details: redactStringRecord(event.event_details, redactions) };
}

function protectContent(
  content: { type?: string; value: TraceRecordValue } | null | undefined,
  redactions: Set<string>,
): { type?: string; value: TraceRecordValue } | null | undefined {
  if (content === null || content === void 0) return content;
  return { ...content, value: redactValue(content.value, redactions) };
}

function protectMetrics(
  metrics: Record<string, TraceRecordValue> | null | undefined,
  canSeeCosts: boolean,
): Record<string, TraceRecordValue> | null | undefined {
  if (metrics === null || metrics === void 0 || canSeeCosts) return metrics;
  const { total_cost: _traceCost, cost: _spanCost, ...otherMetrics } = metrics;
  return otherMetrics;
}

function collectStrings(value: TraceRecordValue | undefined, values: Set<string>): void {
  if (typeof value === "string") {
    values.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, values);
    return;
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) collectStrings(child, values);
  }
}

function redactValue(value: TraceRecordValue, redactions: Set<string>): TraceRecordValue {
  if (redactions.size === 0) return value;
  if (typeof value === "string") return containsRedaction(value, redactions) ? "[REDACTED]" : value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redactions));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, redactValue(child, redactions)]),
  );
}

function redactStringRecord(
  value: Record<string, string>,
  redactions: Set<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      containsRedaction(child, redactions) ? "[REDACTED]" : child,
    ]),
  );
}

function redactRecord(
  value: Record<string, TraceRecordValue>,
  redactions: Set<string>,
): Record<string, TraceRecordValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, redactValue(child, redactions)]),
  );
}

function containsRedaction(value: string, redactions: Set<string>): boolean {
  return [...redactions].some((redaction) => redaction.length > 0 && value.includes(redaction));
}

function isRecord(value: TraceRecordValue | undefined): value is Record<string, TraceRecordValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

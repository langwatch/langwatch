import { CONTENT_KEY_CATALOG, PRIVACY_DROPPED_MARKER_ATTR } from "@langwatch/data-privacy-contract";
import type {
  Protections,
  DerivedTraceEvent,
  Event,
  Span,
  LegacySpanInputOutput,
  SpanMetrics,
  Trace,
} from "@langwatch/trace-contract";
import {
  chatMessageSchema,
  chatRichContentSchema,
  parsePythonInsideJson,
  spanInputOutputSchema,
} from "@langwatch/trace-contract";
import { z } from "zod";

import {
  createAttributeRedactor,
  hiddenContentCategoryRules,
} from "./trace-attribute-redaction.rules.ts";
import { redactSpanContent, redactTraceContent } from "./trace-visibility-teaser.rules.ts";

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
function collectDroppedCategories(spans: Span[] | undefined): string[] {
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

/** The string literals a schema admits, through unions, optionals and nullables. */
function literalStringsOf(schema: unknown): string[] {
  if (schema instanceof z.ZodLiteral) {
    return [...schema.values].filter((value): value is string => typeof value === "string");
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.flatMap((option) => literalStringsOf(option));
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return literalStringsOf(schema.unwrap());
  }

  return [];
}

/** The literals each object arm of a union pins its `key` to. */
function keyLiteralsOf(schema: unknown, key: string): string[] {
  if (schema instanceof z.ZodLazy) {
    return keyLiteralsOf(schema.unwrap(), key);
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.flatMap((option) => keyLiteralsOf(option, key));
  }
  if (schema instanceof z.ZodObject) {
    return literalStringsOf((schema.shape as Record<string, unknown>)[key]);
  }

  return [];
}

/**
 * Every literal a `role` or `type` key takes in the span input/output shapes: the chat roles,
 * the content-part types and the typed-value types, read off the schemas so a new shape is
 * covered the day it is added. They describe a message's shape, not what anyone wrote.
 */
const SPAN_IO_SHAPE_LITERALS: ReadonlySet<string> = new Set([
  ...keyLiteralsOf(chatMessageSchema, "role"),
  ...keyLiteralsOf(chatRichContentSchema, "type"),
  ...keyLiteralsOf(spanInputOutputSchema, "type"),
]);

/**
 * Keys whose shape-describing values ("user", "text", "image_url", ...) stay out of the
 * redaction set, or every attribute that mentions a role would be blanked along with the
 * content. Any other value under these keys is content and is kept.
 */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set(["role", "type"]);

/**
 * Below this length a hidden string is redacted inside another value only where it stands as a
 * whole word: as a bare substring, a short word the content also used ("user") blanks unrelated
 * values that merely contain it ("user_selected").
 */
const MIN_CONTAINED_REDACTION_LENGTH = 8;

/**
 * Scripts whose words are cut by spaces and punctuation alone. Elsewhere (Han, kana, Thai, Hangul
 * with its attached particles, Arabic with its attached prefixes) a word boundary says nothing.
 */
const WORD_BOUNDARY_SCRIPTS = "\\p{sc=Latin}\\p{sc=Greek}\\p{sc=Cyrillic}";
const WORD_CHAR = `[${WORD_BOUNDARY_SCRIPTS}\\p{N}_]`;
/** A string whose letters all come from the word-boundary scripts. */
const BOUNDARY_SCRIPT_ONLY = new RegExp(`^(?:[${WORD_BOUNDARY_SCRIPTS}]|\\P{L})+$`, "u");

function isStructuralValue(key: string, value: unknown): boolean {
  return STRUCTURAL_KEYS.has(key) && typeof value === "string" && SPAN_IO_SHAPE_LITERALS.has(value);
}

/** A string leaf as a redaction; blank strings carry no content and match every value. */
function contentStrings(value: string): string[] {
  return value.trim() === "" ? [] : [value];
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
      return contentStrings(value);
    }

    return contentStrings(value);
  }
}

/**
 * Every string value in an object, so that when input and output are not visible they can be
 * redacted out of the fields that are. Blank strings and the shape words under `role`/`type`
 * are skipped: they carry no content.
 */
export function extractRedactionsForObject(object: unknown): string[] {
  if (typeof object === "string") {
    return extractRedactionsForString(object);
  }

  if (Array.isArray(object)) {
    return object.flatMap((item) => extractRedactionsForObject(item));
  }

  if (typeof object === "object" && object !== null) {
    return Object.entries(object)
      .filter(([key, value]) => !isStructuralValue(key, value))
      .flatMap(([, value]) => extractRedactionsForObject(value));
  }

  return [];
}

interface RedactionMatchers {
  long: string[];
  short: RegExp[];
}

const matchersByRedactions = new WeakMap<Set<string>, RedactionMatchers>();

/** The redaction set split by how each string is matched, compiled once per set. */
function matchersFor(redactions: Set<string>): RedactionMatchers {
  const cached = matchersByRedactions.get(redactions);
  if (cached) return cached;

  const matchers: RedactionMatchers = { long: [], short: [] };
  for (const redaction of redactions) {
    // Only a short string in a word-boundary script is matched as a whole word.
    if (
      redaction.length >= MIN_CONTAINED_REDACTION_LENGTH ||
      !BOUNDARY_SCRIPT_ONLY.test(redaction)
    ) {
      matchers.long.push(redaction);
      continue;
    }
    const escaped = redaction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matchers.short.push(new RegExp(`(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`, "u"));
  }
  matchersByRedactions.set(redactions, matchers);

  return matchers;
}

/**
 * Whether a string carries hidden content: it is one of the hidden strings, quotes a long one
 * anywhere, or holds a short one as a whole word.
 */
function carriesRedaction(value: string, redactions: Set<string>): boolean {
  if (redactions.has(value)) return true;
  const { long, short } = matchersFor(redactions);

  return (
    long.some((redaction) => value.includes(redaction)) ||
    short.some((pattern) => pattern.test(value))
  );
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

  return carriesRedaction(value, redactions) ? "[REDACTED]" : value;
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
  let transformedInput: LegacySpanInputOutput | null | undefined = span.input;
  let transformedOutput: LegacySpanInputOutput | null | undefined = span.output;
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
      } as LegacySpanInputOutput;
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
      } as LegacySpanInputOutput;
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

  // Scrub copies of hidden content first, then replace restricted and hidden-category params
  // whole with the audience placeholder (the matcher walks the unflattened nested paths). In
  // this order the scrub never rewrites a placeholder that shares a word with hidden content.
  const transformedParams = createAttributeRedactor({
    hidden: [
      ...(protections.hiddenAttributes ?? []),
      ...hiddenContentCategoryRules({ protections, contentKeyCatalog: CONTENT_KEY_CATALOG }),
    ],
  })(redactObject(span.params as Record<string, unknown> | null | undefined, redactions));

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
        createAttributeRedactor({ hidden: protections.hiddenAttributes })(event.attributes) ??
        event.attributes,
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
      ...redactTraceContent({ ...traceWithoutSpans, spans: [] }),
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

/**
 * Trace Comparator
 *
 * Semantic field-by-field comparison of traces between ES and CH backends.
 * Handles known divergences (null/undefined/0 equivalence, numeric tolerance).
 */

import type {
  Trace,
  TraceSpan,
  Discrepancy,
  TraceComparisonResult,
  FieldSummary,
  PythonExampleResult,
  SnippetExampleResult,
} from "./types.js";

// ─── Utility Functions (adapted from analytics-parity-check/comparator.ts) ───

function isNumeric(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value);
}

function percentDiff(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  if (a === 0) return Infinity;
  return Math.abs((a - b) / a);
}

function withinTolerance(a: number, b: number, tolerance: number): boolean {
  const absoluteTolerance = Math.max(Math.abs(a * tolerance), 1);
  return Math.abs(a - b) <= absoluteTolerance;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Treat null, undefined, 0, false as equivalent "empty" for fields
 * where backends handle missing values differently
 */
function isEffectivelyEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === 0 || value === false;
}

function deepCompare(
  esValue: unknown,
  chValue: unknown,
  path: string,
  tolerance: number,
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  if (isEmptyValue(esValue) && isEmptyValue(chValue)) return [];
  if (isNumeric(esValue) && esValue === 0 && isEmptyValue(chValue)) return [];
  if (isEmptyValue(esValue) && isNumeric(chValue) && chValue === 0) return [];

  if (isEmptyValue(esValue)) {
    if (!isEmptyValue(chValue)) {
      discrepancies.push({ path, esValue, chValue });
    }
    return discrepancies;
  }
  if (isEmptyValue(chValue)) {
    discrepancies.push({ path, esValue, chValue });
    return discrepancies;
  }

  if (isNumeric(esValue) && isNumeric(chValue)) {
    if (!withinTolerance(esValue, chValue, tolerance)) {
      discrepancies.push({ path, esValue, chValue, percentDiff: percentDiff(esValue, chValue) });
    }
    return discrepancies;
  }

  if (Array.isArray(esValue) && Array.isArray(chValue)) {
    if (esValue.length !== chValue.length) {
      discrepancies.push({ path: `${path}.length`, esValue: esValue.length, chValue: chValue.length });
    }
    const minLen = Math.min(esValue.length, chValue.length);
    for (let i = 0; i < minLen; i++) {
      discrepancies.push(...deepCompare(esValue[i], chValue[i], `${path}[${i}]`, tolerance));
    }
    return discrepancies;
  }

  if (typeof esValue === "object" && typeof chValue === "object" && esValue !== null && chValue !== null) {
    const esObj = esValue as Record<string, unknown>;
    const chObj = chValue as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(esObj), ...Object.keys(chObj)]);
    for (const key of allKeys) {
      discrepancies.push(...deepCompare(esObj[key], chObj[key], `${path}.${key}`, tolerance));
    }
    return discrepancies;
  }

  if (esValue !== chValue) {
    discrepancies.push({ path, esValue, chValue });
  }

  return discrepancies;
}

// ─── Trace-level comparison ───

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function tryExtractText(value: string): string {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed)) {
      // Chat messages format
      return parsed
        .map((m: { content?: string; role?: string }) => m.content ?? "")
        .filter(Boolean)
        .join(" ");
    }
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed);
    }
  } catch {
    // Not JSON, return as-is
  }
  return value;
}

function compareTextValue(
  esValue: string | undefined,
  chValue: string | undefined,
  path: string,
): Discrepancy[] {
  if (isEmptyValue(esValue) && isEmptyValue(chValue)) return [];
  // Treat empty string as equivalent to null for output.value (error traces)
  if ((esValue === "" || isEmptyValue(esValue)) && (chValue === "" || isEmptyValue(chValue))) return [];
  if (isEmptyValue(esValue) || isEmptyValue(chValue)) {
    return [{ path, esValue: esValue ?? null, chValue: chValue ?? null }];
  }

  const esNorm = normalizeText(esValue!);
  const chNorm = normalizeText(chValue!);

  if (esNorm === chNorm) return [];

  // Known divergence: CH may concatenate all chat messages (system + user) into
  // input.value, while ES only uses the last user message.
  // Check if one value is contained within the other.
  if (chNorm.includes(esNorm) || esNorm.includes(chNorm)) return [];

  // Try extracting text from JSON on both sides
  const esText = tryExtractText(esValue!);
  const chText = tryExtractText(chValue!);

  const esTextNorm = normalizeText(esText);
  const chTextNorm = normalizeText(chText);

  if (esTextNorm === chTextNorm) return [];
  if (chTextNorm.includes(esTextNorm) || esTextNorm.includes(chTextNorm)) return [];

  return [{ path, esValue, chValue }];
}

function compareLabels(
  esLabels: string[] | null | undefined,
  chLabels: string[] | null | undefined,
  path: string,
): Discrepancy[] {
  const esSet = new Set(esLabels ?? []);
  const chSet = new Set(chLabels ?? []);

  if (esSet.size === 0 && chSet.size === 0) return [];

  if (esSet.size !== chSet.size) {
    return [{ path, esValue: Array.from(esSet).sort(), chValue: Array.from(chSet).sort() }];
  }

  for (const label of esSet) {
    if (!chSet.has(label)) {
      return [{ path, esValue: Array.from(esSet).sort(), chValue: Array.from(chSet).sort() }];
    }
  }

  return [];
}

function compareSpanInputOutput(
  esIO: { type: string; value: unknown } | null | undefined,
  chIO: { type: string; value: unknown } | null | undefined,
  path: string,
  tolerance: number,
): Discrepancy[] {
  if (isEmptyValue(esIO) && isEmptyValue(chIO)) return [];
  if (isEmptyValue(esIO) || isEmptyValue(chIO)) {
    return [{ path, esValue: esIO ?? null, chValue: chIO ?? null }];
  }

  const discrepancies: Discrepancy[] = [];

  // Compare type
  if (esIO!.type !== chIO!.type) {
    discrepancies.push({ path: `${path}.type`, esValue: esIO!.type, chValue: chIO!.type });
  }

  // Compare value based on type
  const esType = esIO!.type;
  const esVal = esIO!.value;
  const chVal = chIO!.value;

  if (esType === "chat_messages" && Array.isArray(esVal) && Array.isArray(chVal)) {
    discrepancies.push(...deepCompare(esVal, chVal, `${path}.value`, tolerance));
  } else if (esType === "text") {
    discrepancies.push(
      ...compareTextValue(
        typeof esVal === "string" ? esVal : JSON.stringify(esVal),
        typeof chVal === "string" ? chVal : JSON.stringify(chVal),
        `${path}.value`,
      ),
    );
  } else {
    discrepancies.push(...deepCompare(esVal, chVal, `${path}.value`, tolerance));
  }

  return discrepancies;
}

/**
 * Compare two spans from ES and CH
 */
function compareSpans(
  esSpan: TraceSpan,
  chSpan: TraceSpan,
  spanIndex: number,
  tolerance: number,
): Discrepancy[] {
  const prefix = `spans[${spanIndex}]`;
  const discrepancies: Discrepancy[] = [];

  // Type (exact)
  if (esSpan.type !== chSpan.type) {
    discrepancies.push({ path: `${prefix}.type`, esValue: esSpan.type, chValue: chSpan.type });
  }

  // Input/Output
  discrepancies.push(...compareSpanInputOutput(esSpan.input, chSpan.input, `${prefix}.input`, tolerance));
  discrepancies.push(...compareSpanInputOutput(esSpan.output, chSpan.output, `${prefix}.output`, tolerance));

  // Model (exact)
  if ((esSpan.model ?? null) !== (chSpan.model ?? null)) {
    discrepancies.push({ path: `${prefix}.model`, esValue: esSpan.model ?? null, chValue: chSpan.model ?? null });
  }

  // Vendor (exact)
  if ((esSpan.vendor ?? null) !== (chSpan.vendor ?? null)) {
    discrepancies.push({ path: `${prefix}.vendor`, esValue: esSpan.vendor ?? null, chValue: chSpan.vendor ?? null });
  }

  // Span metrics
  if (esSpan.metrics || chSpan.metrics) {
    const esMetrics = esSpan.metrics ?? {};
    const chMetrics = chSpan.metrics ?? {};

    // prompt_tokens (exact)
    if (!bothEffectivelyEmpty(esMetrics.prompt_tokens, chMetrics.prompt_tokens)) {
      if ((esMetrics.prompt_tokens ?? 0) !== (chMetrics.prompt_tokens ?? 0)) {
        discrepancies.push({
          path: `${prefix}.metrics.prompt_tokens`,
          esValue: esMetrics.prompt_tokens ?? null,
          chValue: chMetrics.prompt_tokens ?? null,
        });
      }
    }

    // completion_tokens (exact)
    if (!bothEffectivelyEmpty(esMetrics.completion_tokens, chMetrics.completion_tokens)) {
      if ((esMetrics.completion_tokens ?? 0) !== (chMetrics.completion_tokens ?? 0)) {
        discrepancies.push({
          path: `${prefix}.metrics.completion_tokens`,
          esValue: esMetrics.completion_tokens ?? null,
          chValue: chMetrics.completion_tokens ?? null,
        });
      }
    }

    // cost (numeric tolerance)
    if (!bothEffectivelyEmpty(esMetrics.cost, chMetrics.cost)) {
      const esCost = esMetrics.cost ?? 0;
      const chCost = chMetrics.cost ?? 0;
      if (isNumeric(esCost) && isNumeric(chCost) && !withinTolerance(esCost, chCost, tolerance)) {
        discrepancies.push({
          path: `${prefix}.metrics.cost`,
          esValue: esCost,
          chValue: chCost,
          percentDiff: percentDiff(esCost, chCost),
        });
      }
    }

    // tokens_estimated (null/false/0 equivalence)
    // Skip — both backends handle this differently
  }

  // Contexts (RAG) - deep array comparison
  if (esSpan.contexts || chSpan.contexts) {
    discrepancies.push(
      ...deepCompare(esSpan.contexts ?? [], chSpan.contexts ?? [], `${prefix}.contexts`, tolerance),
    );
  }

  // Skip params (known divergence: CH returns raw attributes, ES returns filtered subset)
  // Skip error at span level (compared at trace level)

  return discrepancies;
}

function bothEffectivelyEmpty(a: unknown, b: unknown): boolean {
  return isEffectivelyEmpty(a) && isEffectivelyEmpty(b);
}

/**
 * Compare a single trace from ES and CH (same trace_id)
 */
export function compareTrace(esTrace: Trace, chTrace: Trace, tolerance: number): TraceComparisonResult {
  const discrepancies: Discrepancy[] = [];

  // input.value
  discrepancies.push(...compareTextValue(esTrace.input?.value, chTrace.input?.value, "input.value"));

  // output.value
  discrepancies.push(...compareTextValue(esTrace.output?.value, chTrace.output?.value, "output.value"));

  // Metadata
  const esMeta = esTrace.metadata ?? {};
  const chMeta = chTrace.metadata ?? {};

  // thread_id (exact)
  if ((esMeta.thread_id ?? null) !== (chMeta.thread_id ?? null)) {
    discrepancies.push({ path: "metadata.thread_id", esValue: esMeta.thread_id ?? null, chValue: chMeta.thread_id ?? null });
  }

  // user_id (exact)
  if ((esMeta.user_id ?? null) !== (chMeta.user_id ?? null)) {
    discrepancies.push({ path: "metadata.user_id", esValue: esMeta.user_id ?? null, chValue: chMeta.user_id ?? null });
  }

  // customer_id (exact)
  if ((esMeta.customer_id ?? null) !== (chMeta.customer_id ?? null)) {
    discrepancies.push({ path: "metadata.customer_id", esValue: esMeta.customer_id ?? null, chValue: chMeta.customer_id ?? null });
  }

  // labels (set comparison)
  discrepancies.push(...compareLabels(esMeta.labels, chMeta.labels, "metadata.labels"));

  // sdk_* fields — ES stores in telemetry.sdk.*, CH stores in sdk_*
  // Compare cross-mapped: ES telemetry.sdk.name == CH sdk_name, etc.
  const esSdkName = (esMeta.sdk_name ?? esMeta["telemetry.sdk.name"] ?? null) as string | null;
  const chSdkName = (chMeta.sdk_name ?? chMeta["telemetry.sdk.name"] ?? null) as string | null;
  if (esSdkName !== chSdkName) {
    discrepancies.push({ path: "metadata.sdk_name", esValue: esSdkName, chValue: chSdkName });
  }

  const esSdkVersion = (esMeta.sdk_version ?? esMeta["telemetry.sdk.version"] ?? null) as string | null;
  const chSdkVersion = (chMeta.sdk_version ?? chMeta["telemetry.sdk.version"] ?? null) as string | null;
  if (esSdkVersion !== chSdkVersion) {
    discrepancies.push({ path: "metadata.sdk_version", esValue: esSdkVersion, chValue: chSdkVersion });
  }

  const esSdkLang = (esMeta.sdk_language ?? esMeta["telemetry.sdk.language"] ?? null) as string | null;
  const chSdkLang = (chMeta.sdk_language ?? chMeta["telemetry.sdk.language"] ?? null) as string | null;
  if (esSdkLang !== chSdkLang) {
    discrepancies.push({ path: "metadata.sdk_language", esValue: esSdkLang, chValue: chSdkLang });
  }

  // Custom metadata (exact per key, skip known reserved & resource attribute keys)
  // Resource attributes (host.*, process.*, telemetry.sdk.*) are OTEL resource-level
  // metadata that ES stores but CH doesn't — skip them as they're not business metadata
  const reservedKeys = new Set([
    "thread_id", "user_id", "customer_id", "labels",
    "sdk_name", "sdk_version", "sdk_language",
    "telemetry_sdk_language", "telemetry_sdk_name", "telemetry_sdk_version",
    "topic_id", "subtopic_id", "prompt_ids", "prompt_version_ids",
    "custom", "all_keys",
    "parity.run", "parity_run",
  ]);

  const resourceAttributePrefixes = [
    "host.", "process.", "telemetry.sdk.", "telemetry_sdk_",
    "service.", "os.",
  ];

  function isResourceAttribute(key: string): boolean {
    return resourceAttributePrefixes.some((prefix) => key.startsWith(prefix));
  }

  const allMetaKeys = new Set([
    ...Object.keys(esMeta).filter((k) => !reservedKeys.has(k) && !isResourceAttribute(k)),
    ...Object.keys(chMeta).filter((k) => !reservedKeys.has(k) && !isResourceAttribute(k)),
  ]);

  for (const key of allMetaKeys) {
    discrepancies.push(...deepCompare(esMeta[key], chMeta[key], `metadata.${key}`, tolerance));
  }

  // Trace metrics
  const esMetrics = esTrace.metrics ?? {};
  const chMetrics = chTrace.metrics ?? {};

  // prompt_tokens (exact)
  if (!bothEffectivelyEmpty(esMetrics.prompt_tokens, chMetrics.prompt_tokens)) {
    if ((esMetrics.prompt_tokens ?? 0) !== (chMetrics.prompt_tokens ?? 0)) {
      discrepancies.push({
        path: "metrics.prompt_tokens",
        esValue: esMetrics.prompt_tokens ?? null,
        chValue: chMetrics.prompt_tokens ?? null,
      });
    }
  }

  // completion_tokens (exact)
  if (!bothEffectivelyEmpty(esMetrics.completion_tokens, chMetrics.completion_tokens)) {
    if ((esMetrics.completion_tokens ?? 0) !== (chMetrics.completion_tokens ?? 0)) {
      discrepancies.push({
        path: "metrics.completion_tokens",
        esValue: esMetrics.completion_tokens ?? null,
        chValue: chMetrics.completion_tokens ?? null,
      });
    }
  }

  // total_cost (numeric tolerance)
  if (!bothEffectivelyEmpty(esMetrics.total_cost, chMetrics.total_cost)) {
    const esCost = esMetrics.total_cost ?? 0;
    const chCost = chMetrics.total_cost ?? 0;
    if (isNumeric(esCost) && isNumeric(chCost) && !withinTolerance(esCost, chCost, tolerance)) {
      discrepancies.push({
        path: "metrics.total_cost",
        esValue: esCost,
        chValue: chCost,
        percentDiff: percentDiff(esCost, chCost),
      });
    }
  }

  // total_time_ms (numeric tolerance)
  if (!bothEffectivelyEmpty(esMetrics.total_time_ms, chMetrics.total_time_ms)) {
    const esTime = esMetrics.total_time_ms ?? 0;
    const chTime = chMetrics.total_time_ms ?? 0;
    if (isNumeric(esTime) && isNumeric(chTime) && !withinTolerance(esTime, chTime, tolerance)) {
      discrepancies.push({
        path: "metrics.total_time_ms",
        esValue: esTime,
        chValue: chTime,
        percentDiff: percentDiff(esTime, chTime),
      });
    }
  }

  // first_token_ms (numeric tolerance)
  if (!bothEffectivelyEmpty(esMetrics.first_token_ms, chMetrics.first_token_ms)) {
    const esTime = esMetrics.first_token_ms ?? 0;
    const chTime = chMetrics.first_token_ms ?? 0;
    if (isNumeric(esTime) && isNumeric(chTime) && !withinTolerance(esTime, chTime, tolerance)) {
      discrepancies.push({
        path: "metrics.first_token_ms",
        esValue: esTime,
        chValue: chTime,
        percentDiff: percentDiff(esTime, chTime),
      });
    }
  }

  // tokens_estimated (null/false/0 equivalence — skip)

  // Error
  if (esTrace.error || chTrace.error) {
    const esHasError = esTrace.error?.has_error ?? false;
    const chHasError = chTrace.error?.has_error ?? false;
    if (esHasError !== chHasError) {
      discrepancies.push({ path: "error.has_error", esValue: esHasError, chValue: chHasError });
    }
    if (esHasError && chHasError) {
      // Normalize error messages: ES may prefix with "Error: " while CH doesn't
      const esMsg = (esTrace.error?.message ?? "").replace(/^Error:\s*/, "");
      const chMsg = (chTrace.error?.message ?? "").replace(/^Error:\s*/, "");
      if (esMsg !== chMsg) {
        discrepancies.push({
          path: "error.message",
          esValue: esTrace.error?.message ?? null,
          chValue: chTrace.error?.message ?? null,
        });
      }
    }
  }

  // Span comparison
  // Note: The trace search API doesn't return spans for ES (only CH returns them
  // in non-digest format). Skip span-level comparison when either side has 0 spans
  // since that's an API limitation, not a data parity issue.
  const esSpans = sortSpans(esTrace.spans ?? []);
  const chSpans = sortSpans(chTrace.spans ?? []);

  if (esSpans.length > 0 && chSpans.length > 0) {
    if (esSpans.length !== chSpans.length) {
      discrepancies.push({ path: "spans.length", esValue: esSpans.length, chValue: chSpans.length });
    }

    // Per-span comparison
    const minSpans = Math.min(esSpans.length, chSpans.length);
    for (let i = 0; i < minSpans; i++) {
      discrepancies.push(...compareSpans(esSpans[i]!, chSpans[i]!, i, tolerance));
    }
  }

  // Skip evaluations (CH may not have them yet)

  return {
    traceId: esTrace.trace_id,
    passed: discrepancies.length === 0,
    discrepancies,
  };
}

/**
 * Sort spans deterministically by parent_id then name for stable comparison
 */
function sortSpans(spans: TraceSpan[]): TraceSpan[] {
  return [...spans].sort((a, b) => {
    // Root spans first
    const aIsRoot = !a.parent_id;
    const bIsRoot = !b.parent_id;
    if (aIsRoot !== bIsRoot) return aIsRoot ? -1 : 1;

    // Then by start time
    if (a.timestamps.started_at !== b.timestamps.started_at) {
      return a.timestamps.started_at - b.timestamps.started_at;
    }

    // Then by name
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

/**
 * Compare all matched OTEL traces and produce field summaries
 */
export function compareAllTraces(
  esTraces: Trace[],
  chTraces: Trace[],
  tolerance: number,
): { results: TraceComparisonResult[]; fieldSummaries: FieldSummary[] } {
  // Build lookup by trace_id
  const chTraceMap = new Map(chTraces.map((t) => [t.trace_id, t]));

  const results: TraceComparisonResult[] = [];
  const fieldDiscrepancies = new Map<string, FieldSummary>();

  // Only compare traces that exist on BOTH backends (same trace_id).
  // Traces that only exist on one side (e.g. Python SDK examples sent
  // to a single backend) are handled separately via pythonExampleResults.
  for (const esTrace of esTraces) {
    const chTrace = chTraceMap.get(esTrace.trace_id);
    if (!chTrace) {
      continue;
    }

    const result = compareTrace(esTrace, chTrace, tolerance);
    results.push(result);

    // Accumulate field summaries
    const seenFields = new Set<string>();
    for (const disc of result.discrepancies) {
      // Normalize field path (remove array indices for summary)
      const fieldName = disc.path.replace(/\[\d+\]/g, "[]");
      seenFields.add(fieldName);

      const summary = fieldDiscrepancies.get(fieldName) ?? {
        field: fieldName,
        total: 0,
        passed: 0,
        failed: 0,
        failures: [],
      };
      summary.failures.push({
        traceId: esTrace.trace_id,
        esValue: disc.esValue,
        chValue: disc.chValue,
        percentDiff: disc.percentDiff,
      });
      fieldDiscrepancies.set(fieldName, summary);
    }
  }

  // Count totals for each field
  const totalTraces = results.length;
  const allFields = new Set<string>();

  // Collect all fields that were checked
  for (const result of results) {
    for (const disc of result.discrepancies) {
      allFields.add(disc.path.replace(/\[\d+\]/g, "[]"));
    }
  }

  // Add fields that always passed
  const knownFields = [
    "input.value", "output.value",
    "metadata.thread_id", "metadata.user_id", "metadata.customer_id", "metadata.labels",
    "metrics.prompt_tokens", "metrics.completion_tokens", "metrics.total_cost",
    "metrics.total_time_ms", "metrics.first_token_ms",
    "error.has_error", "error.message",
    "spans.length", "spans[].type", "spans[].input", "spans[].output",
    "spans[].model", "spans[].vendor", "spans[].metrics.prompt_tokens",
    "spans[].metrics.completion_tokens", "spans[].metrics.cost",
    "spans[].contexts",
  ];

  const fieldSummaries: FieldSummary[] = [];
  for (const field of knownFields) {
    const summary = fieldDiscrepancies.get(field) ?? {
      field,
      total: totalTraces,
      passed: totalTraces,
      failed: 0,
      failures: [],
    };
    summary.total = totalTraces;
    summary.failed = summary.failures.length;
    summary.passed = totalTraces - summary.failed;
    fieldSummaries.push(summary);
  }

  // Add any extra fields that had discrepancies but aren't in known list
  for (const [field, summary] of fieldDiscrepancies) {
    if (!knownFields.includes(field)) {
      summary.total = totalTraces;
      summary.failed = summary.failures.length;
      summary.passed = totalTraces - summary.failed;
      fieldSummaries.push(summary);
    }
  }

  return { results, fieldSummaries };
}

/**
 * Validate Python SDK traces (structural comparison, not exact values).
 *
 * Since each backend gets a separate run with different LLM responses,
 * we validate structure rather than exact values:
 * - Both traces exist and are retrievable
 * - Trace-level input/output are populated
 * - Span structure is reasonable (CH only — ES search API doesn't return spans)
 * - Metadata fields are populated if expected
 */
export function validatePythonTraces({
  exampleName,
  esTrace,
  chTrace,
  esTraceId,
  chTraceId,
}: {
  exampleName: string;
  esTrace: Trace | null;
  chTrace: Trace | null;
  esTraceId: string | null;
  chTraceId: string | null;
}): PythonExampleResult {
  const issues: string[] = [];

  if (!esTrace) {
    issues.push("ES trace not found");
  }
  if (!chTrace) {
    issues.push("CH trace not found");
  }

  if (!esTrace || !chTrace) {
    return {
      exampleName,
      esTraceId,
      chTraceId,
      esTrace,
      chTrace,
      structuralMatch: false,
      issues,
    };
  }

  // Trace-level input/output populated on both backends
  if (!esTrace.input?.value) {
    issues.push("ES: trace input is empty");
  }
  if (!chTrace.input?.value) {
    issues.push("CH: trace input is empty");
  }

  // Output may be empty for error/exception traces — don't flag as an issue
  // since the LLM call intentionally throws before producing output.
  const isErrorExample = exampleName.includes("exception") || exampleName.includes("error");
  if (!isErrorExample && !esTrace.output?.value && !chTrace.output?.value) {
    issues.push("Both: trace output is empty");
  }

  // Span validation — ES search API doesn't return spans (they're in a separate
  // index). Only validate CH spans for structural correctness.
  const chSpans = chTrace.spans ?? [];
  if (chSpans.length === 0) {
    issues.push("CH: no spans returned");
  }

  if (!isErrorExample) {
    for (const span of chSpans) {
      if (span.type === "llm") {
        if (!span.input) {
          issues.push(`CH: LLM span ${span.span_id} has no input`);
        }
        if (!span.output) {
          issues.push(`CH: LLM span ${span.span_id} has no output`);
        }
      }
    }
  }

  // If ES does return spans, compare span counts between backends
  const esSpans = esTrace.spans ?? [];
  if (esSpans.length > 0 && chSpans.length > 0) {
    if (esSpans.length !== chSpans.length) {
      issues.push(
        `Span count mismatch: ES=${esSpans.length} CH=${chSpans.length}`,
      );
    }

    const esTypes = esSpans.map((s) => s.type).sort();
    const chTypes = chSpans.map((s) => s.type).sort();
    if (JSON.stringify(esTypes) !== JSON.stringify(chTypes)) {
      issues.push(
        `Span types mismatch: ES=[${esTypes.join(",")}] CH=[${chTypes.join(",")}]`,
      );
    }
  }

  // Metadata: if one backend has user_id/thread_id, the other should too.
  // CH may store custom metadata with a "metadata." prefix (e.g. "metadata.user_id").
  const esUserId = esTrace.metadata.user_id ?? esTrace.metadata["metadata.user_id"] ?? null;
  const chUserId = chTrace.metadata.user_id ?? chTrace.metadata["metadata.user_id"] ?? null;
  if (esUserId && !chUserId) {
    issues.push("CH: missing user_id in metadata");
  }
  if (chUserId && !esUserId) {
    issues.push("ES: missing user_id in metadata");
  }

  const esThreadId = esTrace.metadata.thread_id ?? esTrace.metadata["metadata.thread_id"] ?? null;
  const chThreadId = chTrace.metadata.thread_id ?? chTrace.metadata["metadata.thread_id"] ?? null;
  if (esThreadId && !chThreadId) {
    issues.push("CH: missing thread_id in metadata");
  }
  if (chThreadId && !esThreadId) {
    issues.push("ES: missing thread_id in metadata");
  }

  return {
    exampleName,
    esTraceId,
    chTraceId,
    esTrace,
    chTrace,
    structuralMatch: issues.length === 0,
    issues,
  };
}

/**
 * Validate onboarding snippet traces (structural comparison).
 *
 * Similar to validatePythonTraces but for onboarding snippets.
 * Each backend gets a separate run with different LLM responses,
 * so we validate structure rather than exact values.
 */
export function validateSnippetTraces({
  snippetName,
  esTrace,
  chTrace,
  esTraceId,
  chTraceId,
}: {
  snippetName: string;
  esTrace: Trace | null;
  chTrace: Trace | null;
  esTraceId: string | null;
  chTraceId: string | null;
}): SnippetExampleResult {
  const issues: string[] = [];

  if (!esTrace) {
    issues.push("ES trace not found");
  }
  if (!chTrace) {
    issues.push("CH trace not found");
  }

  if (!esTrace || !chTrace) {
    return {
      snippetName,
      esTraceId,
      chTraceId,
      esMatchMethod: null,
      chMatchMethod: null,
      esSummary: null,
      chSummary: null,
      esTrace,
      chTrace,
      structuralMatch: false,
      issues,
    };
  }

  // Trace-level input should be populated on both backends
  if (!esTrace.input?.value) {
    issues.push("ES: trace input is empty");
  }
  if (!chTrace.input?.value) {
    issues.push("CH: trace input is empty");
  }

  // Output should be populated (snippets are not error examples)
  if (!esTrace.output?.value) {
    issues.push("ES: trace output is empty");
  }
  if (!chTrace.output?.value) {
    issues.push("CH: trace output is empty");
  }

  // Both backends should agree on whether input/output exist
  if (!!esTrace.input?.value !== !!chTrace.input?.value) {
    issues.push(`Input presence mismatch: ES=${!!esTrace.input?.value} CH=${!!chTrace.input?.value}`);
  }
  if (!!esTrace.output?.value !== !!chTrace.output?.value) {
    issues.push(`Output presence mismatch: ES=${!!esTrace.output?.value} CH=${!!chTrace.output?.value}`);
  }

  // Compare metrics if both have them
  const esTokens = esTrace.metrics?.prompt_tokens;
  const chTokens = chTrace.metrics?.prompt_tokens;
  if (esTokens && chTokens && esTokens > 0 && chTokens > 0) {
    // Both have prompt tokens — they should be in the same ballpark
    if (Math.abs(esTokens - chTokens) / Math.max(esTokens, chTokens) > 0.5) {
      issues.push(`Prompt tokens diverge: ES=${esTokens} CH=${chTokens}`);
    }
  }

  // CH spans should be present (search API includes spans for CH)
  const chSpans = chTrace.spans ?? [];
  if (chSpans.length === 0) {
    issues.push("CH: no spans returned");
  }

  // Validate LLM spans have input/output
  for (const span of chSpans) {
    if (span.type === "llm") {
      if (!span.input) {
        issues.push(`CH: LLM span ${span.span_id.slice(0, 8)} has no input`);
      }
      if (!span.output) {
        issues.push(`CH: LLM span ${span.span_id.slice(0, 8)} has no output`);
      }
    }
  }

  return {
    snippetName,
    esTraceId,
    chTraceId,
    esMatchMethod: null,
    chMatchMethod: null,
    esSummary: null,
    chSummary: null,
    esTrace,
    chTrace,
    structuralMatch: issues.length === 0,
    issues,
  };
}

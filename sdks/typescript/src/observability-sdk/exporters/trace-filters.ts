import { type ReadableSpan } from "@opentelemetry/sdk-trace-base";

export interface Criteria {
  instrumentationScopeName?: Match[];
  name?: Match[];
}

export interface Match {
  equals?: string;
  startsWith?: string;
  matches?: RegExp;
  ignoreCase?: boolean;
}

export type TraceFilter =
  | { preset: "vercelAIOnly" | "excludeHttpRequests" }
  | { include: Criteria }
  | { exclude: Criteria };

/**
 * Applies filters to spans sequentially (AND semantics).
 * @param filters - Filter rules to apply in sequence
 * @param spans - Array of spans to filter
 */
export function applyFilters(
  filters: TraceFilter[] | undefined,
  spans: ReadableSpan[],
): ReadableSpan[] {
  if (!filters || filters.length === 0) return spans;
  return filters.reduce((current, rule) => applyFilterRule(rule, current), spans);
}

/**
 * Applies a single filter rule (preset, include, or exclude).
 * @param rule - Filter rule to apply
 * @param spans - Array of spans to filter
 */
export function applyFilterRule(rule: TraceFilter, spans: ReadableSpan[]): ReadableSpan[] {
  if ("preset" in rule && rule.preset) {
    return applyPreset(rule.preset, spans);
  }

  if ("include" in rule && rule.include) {
    const criteria = (rule as { include: Criteria }).include;
    return spans.filter((s) => matchesCriteria(s, criteria));
  }

  if ("exclude" in rule && rule.exclude) {
    const criteria = (rule as { exclude: Criteria }).exclude;
    return spans.filter((s) => !matchesCriteria(s, criteria));
  }

  return spans;
}

/**
 * Applies a preset filter: vercelAIOnly or excludeHttpRequests.
 * @param preset - Preset filter name
 * @param spans - Array of spans to filter
 */
export function applyPreset(
  preset: "vercelAIOnly" | "excludeHttpRequests",
  spans: ReadableSpan[],
): ReadableSpan[] {
  if (preset === "vercelAIOnly") return spans.filter((s) => isVercelAiSpan(s));
  if (preset === "excludeHttpRequests") return spans.filter((s) => !isHttpRequestSpan(s));

  return spans;
}

/**
 * Checks if a span matches criteria (AND within fields, OR within each field).
 * @param span - Span to evaluate
 * @param criteria - Criteria to match against
 */
export function matchesCriteria(span: ReadableSpan, criteria: Criteria): boolean {
  if (criteria.instrumentationScopeName !== void 0) {
    const scopeName = span.instrumentationScope?.name ?? "";
    const ok = criteria.instrumentationScopeName.some((m) => valueMatches(scopeName, m));
    if (!ok) return false;
  }

  if (criteria.name !== void 0) {
    const ok = criteria.name.some((m) => valueMatches(span.name ?? "", m));
    if (!ok) return false;
  }

  return true;
}

/**
 * Evaluates if a string matches a rule (equals, startsWith, or regex).
 * Case-sensitive by default unless ignoreCase is true.
 * @param value - String to evaluate
 * @param rule - Match rule
 */
export function valueMatches(value: string, rule: Match): boolean {
  const raw = value ?? "";
  const ignoreCase = rule.ignoreCase ?? false;

  if (rule.equals !== void 0) {
    return ignoreCase
      ? raw.localeCompare(rule.equals, void 0, { sensitivity: "base" }) === 0
      : raw === rule.equals;
  }

  if (rule.startsWith !== void 0) {
    return ignoreCase
      ? raw.toLowerCase().startsWith(rule.startsWith.toLowerCase())
      : raw.startsWith(rule.startsWith);
  }

  if (rule.matches instanceof RegExp) {
    const flags = rule.matches.flags;
    const re =
      ignoreCase && !flags.includes("i")
        ? new RegExp(rule.matches.source, (flags || "") + "i")
        : rule.matches;
    return re.test(raw);
  }

  return false;
}

/**
 * Checks if a span is from the Vercel AI SDK (scope name === 'ai', case-insensitive).
 * @param span - Span to check
 */
export function isVercelAiSpan(span: ReadableSpan): boolean {
  const scope = span.instrumentationScope?.name?.toLowerCase?.() ?? "";
  return scope === "ai";
}

/**
 * Instrumentation scopes that emit HTTP client/server request spans. Only
 * fully qualified package scopes count: an application is free to name its
 * own instrumentation "fetch" or "undici", and such spans are user data.
 */
const HTTP_INSTRUMENTATION_SCOPES = new Set([
  "@opentelemetry/instrumentation-http",
  "@opentelemetry/instrumentation-undici",
  "@opentelemetry/instrumentation-fetch",
]);

/**
 * Checks if a span is an HTTP instrumentation span.
 * Checks scope, then http.request.method attribute, then name heuristic.
 * @param span - Span to check
 */
export function isHttpRequestSpan(span: ReadableSpan): boolean {
  const scopeName = span.instrumentationScope?.name ?? "";
  if (HTTP_INSTRUMENTATION_SCOPES.has(scopeName)) return true;

  const attributes = (span.attributes ?? {}) as Record<string, unknown>;
  if (attributes["http.request.method"] !== undefined || attributes["http.method"] !== undefined) {
    return true;
  }

  return /^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|CONNECT|TRACE)( |$)/.test(span.name ?? "");
}

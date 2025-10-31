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
 * Applies a sequence of filters to an array of spans using AND semantics.
 * Each filter in the sequence is applied to the result of the previous filter,
 * progressively narrowing down the set of spans.
 *
 * @param filters - Array of filter rules to apply sequentially
 * @param spans - Array of spans to filter
 * @returns Filtered array of spans that match all filter criteria
 *
 * @example
 * ```typescript
 * const filters: TraceFilter[] = [
 *   { include: { instrumentationScopeName: [{ equals: 'ai' }] } },
 *   { preset: 'excludeHttpRequests' }
 * ];
 * const filtered = applyFilters(filters, spans);
 * // Returns only AI spans that are not HTTP requests
 * ```
 */
export function applyFilters(
  filters: TraceFilter[] | undefined,
  spans: ReadableSpan[]
): ReadableSpan[] {
  if (!filters || filters.length === 0) return spans;
  return filters.reduce((current, rule) => applyFilterRule(rule, current), spans);
}

/**
 * Applies a single filter rule to an array of spans.
 * Handles three types of filters: presets, include rules, and exclude rules.
 *
 * @param rule - Single filter rule (preset, include, or exclude)
 * @param spans - Array of spans to filter
 * @returns Filtered array of spans based on the rule
 *
 * @example
 * ```typescript
 * // Using preset
 * const filtered1 = applyFilterRule({ preset: 'vercelAIOnly' }, spans);
 *
 * // Using include
 * const filtered2 = applyFilterRule(
 *   { include: { name: [{ startsWith: 'llm.' }] } },
 *   spans
 * );
 *
 * // Using exclude
 * const filtered3 = applyFilterRule(
 *   { exclude: { instrumentationScopeName: [{ equals: 'http' }] } },
 *   spans
 * );
 * ```
 */
export function applyFilterRule(rule: TraceFilter, spans: ReadableSpan[]): ReadableSpan[] {
  if ("preset" in rule && rule.preset) {
    return applyPreset(
      (rule as { preset: TraceFilter extends { preset: infer P } ? P : never }).preset as any,
      spans
    );
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
 * Applies a preset filter to an array of spans.
 * Presets are predefined common filtering patterns.
 *
 * Available presets:
 * - `vercelAIOnly`: Keeps only spans from the Vercel AI SDK (instrumentationScope.name === 'ai')
 * - `excludeHttpRequests`: Removes spans that appear to be HTTP requests (span name starts with HTTP verb)
 *
 * @param preset - Name of the preset filter to apply
 * @param spans - Array of spans to filter
 * @returns Filtered array of spans based on the preset
 *
 * @example
 * ```typescript
 * // Keep only Vercel AI spans
 * const aiSpans = applyPreset('vercelAIOnly', spans);
 *
 * // Remove HTTP request spans
 * const noHttpSpans = applyPreset('excludeHttpRequests', spans);
 * ```
 */
export function applyPreset(
  preset: "vercelAIOnly" | "excludeHttpRequests",
  spans: ReadableSpan[]
): ReadableSpan[] {
  if (preset === "vercelAIOnly") return spans.filter((s) => isVercelAiSpan(s));
  if (preset === "excludeHttpRequests") return spans.filter((s) => !isHttpRequestSpan(s));

  return spans;
}

/**
 * Checks if a span matches the given criteria.
 * All specified criteria fields must match (AND semantics within a criteria object).
 * Within each field, matchers are evaluated with OR semantics (any matcher can match).
 *
 * @param span - Span to evaluate
 * @param criteria - Criteria to match against (instrumentationScopeName and/or name)
 * @returns True if the span matches all specified criteria, false otherwise
 *
 * @example
 * ```typescript
 * const criteria: Criteria = {
 *   instrumentationScopeName: [{ equals: 'ai' }],
 *   name: [{ startsWith: 'llm.' }, { startsWith: 'chat.' }]
 * };
 * const matches = matchesCriteria(span, criteria);
 * // Returns true if scope is 'ai' AND name starts with 'llm.' OR 'chat.'
 * ```
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
 * Evaluates if a string value matches a given match rule.
 * Supports three types of matching: exact equality, prefix matching, and regex matching.
 * All matching is case-sensitive by default unless `ignoreCase` is explicitly set to true.
 *
 * @param value - String value to evaluate
 * @param rule - Match rule specifying the matching criteria
 * @returns True if the value matches the rule, false otherwise
 *
 * @example
 * ```typescript
 * // Exact match (case-sensitive by default)
 * valueMatches('GET /api/users', { equals: 'GET /api/users' }); // true
 * valueMatches('get /api/users', { equals: 'GET /api/users' }); // false
 *
 * // Case-insensitive exact match
 * valueMatches('get /api/users', { equals: 'GET /api/users', ignoreCase: true }); // true
 *
 * // Prefix match
 * valueMatches('GET /api/users', { startsWith: 'GET' }); // true
 * valueMatches('POST /api/users', { startsWith: 'GET' }); // false
 *
 * // Regex match
 * valueMatches('GET /api/users', { matches: /^(GET|POST)\b/ }); // true
 *
 * // Case-insensitive regex
 * valueMatches('get /api/users', { matches: /^GET\b/, ignoreCase: true }); // true
 * ```
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
    const re =
      ignoreCase && !rule.matches.flags.includes("i")
        ? new RegExp(rule.matches.source, (rule.matches.flags || "") + "i")
        : rule.matches;
    return re.test(raw);
  }

  return false;
}

/**
 * Checks if a span is from the Vercel AI SDK.
 * A span is considered a Vercel AI span if its instrumentation scope name is 'ai' (case-insensitive).
 *
 * @param span - Span to check
 * @returns True if the span is from the Vercel AI SDK, false otherwise
 *
 * @example
 * ```typescript
 * if (isVercelAiSpan(span)) {
 *   console.log('This is a Vercel AI operation');
 * }
 * ```
 */
export function isVercelAiSpan(span: ReadableSpan): boolean {
  const scope = span.instrumentationScope?.name?.toLowerCase?.() ?? "";
  return scope === "ai";
}

/**
 * Checks if a span appears to be an HTTP request based on its name.
 * A span is considered an HTTP request if its name starts with a common HTTP verb
 * (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD) followed by a word boundary.
 *
 * @param span - Span to check
 * @returns True if the span appears to be an HTTP request, false otherwise
 *
 * @example
 * ```typescript
 * // These would return true:
 * // span.name = "GET /api/users"
 * // span.name = "POST /api/data"
 * // span.name = "DELETE /resource/123"
 *
 * if (isHttpRequestSpan(span)) {
 *   console.log('This is an HTTP request span');
 * }
 * ```
 */
export function isHttpRequestSpan(span: ReadableSpan): boolean {
  const name = span.name ?? "";
  const verbMatch = /^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/i.test(name);
  return verbMatch;
}

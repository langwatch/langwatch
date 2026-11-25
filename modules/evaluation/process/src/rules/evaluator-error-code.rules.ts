/**
 * The closed set of codes a stored evaluator error message reads as. A run stores only free
 * text, which may hold trace text or a provider echo, so outside readers get the code alone.
 * Patterns are RE2 and JavaScript alike and match the lowercased message.
 */
export const EVALUATOR_ERROR_CODE_PATTERNS: readonly (readonly [code: string, pattern: string])[] =
  [
    [
      "evaluator_input_too_large",
      "input is too large|payload too large|entity too large|\\b413\\b",
    ],
    ["evaluator_missing_field", " is required for .* evaluator"],
    ["evaluator_not_found", "evaluator[^.]* not found"],
    ["trace_not_evaluatable", "is not evaluatable"],
    ["timeout", "timed out|timeout|deadline exceeded"],
    ["rate_limited", "rate limit|too many requests|\\b429\\b"],
    ["context_length_exceeded", "context length|context window|maximum context|too many tokens"],
    ["content_filtered", "content filter|content_filter|content management policy"],
    [
      "provider_auth",
      "unauthori[sz]ed|invalid api key|incorrect api key|authentication|\\b401\\b|\\b403\\b",
    ],
    [
      "evaluator_unavailable",
      "\\b50[234]\\b|service unavailable|bad gateway|connection refused|econnrefused|econnreset|socket hang up",
    ],
  ];

/** A message that is already one plain lowercase word or snake_case code, kept as it is. */
export const EVALUATOR_ERROR_PLAIN_CODE_PATTERN = "^[a-z][a-z0-9]*(_[a-z0-9]+)*$";
export const EVALUATOR_ERROR_PLAIN_CODE_MAX_LENGTH = 48;
export const EVALUATOR_ERROR_OTHER_CODE = "other";

/** The code one stored error message reads as; the memory twin of the ClickHouse expression. */
export function evaluatorErrorCodeOf(message: string | null): string {
  const text = (message ?? "").replace(/^ +| +$/g, "");
  if (
    text.length <= EVALUATOR_ERROR_PLAIN_CODE_MAX_LENGTH &&
    new RegExp(EVALUATOR_ERROR_PLAIN_CODE_PATTERN).test(text)
  ) {
    return text;
  }
  const lowered = text.toLowerCase();
  for (const [code, pattern] of EVALUATOR_ERROR_CODE_PATTERNS) {
    if (new RegExp(pattern).test(lowered)) return code;
  }
  return EVALUATOR_ERROR_OTHER_CODE;
}

/**
 * The ClickHouse expression over `column` with the same answer as `evaluatorErrorCodeOf`.
 * Patterns and codes travel as query parameters, so no message text leaves ClickHouse.
 */
export function evaluatorErrorCodeSql({ column }: { column: string }): {
  sql: string;
  params: Record<string, string | number>;
} {
  const params: Record<string, string | number> = {
    errorPlainCode: EVALUATOR_ERROR_PLAIN_CODE_PATTERN,
    errorPlainCodeMax: EVALUATOR_ERROR_PLAIN_CODE_MAX_LENGTH,
    errorOtherCode: EVALUATOR_ERROR_OTHER_CODE,
  };
  const text = `trim(BOTH ' ' FROM ifNull(${column}, ''))`;
  const arms = [
    `lengthUTF8(${text}) <= {errorPlainCodeMax:UInt32} AND match(${text}, {errorPlainCode:String}), ${text}`,
  ];
  EVALUATOR_ERROR_CODE_PATTERNS.forEach(([code, pattern], index) => {
    params[`errorPattern${index}`] = pattern;
    params[`errorCode${index}`] = code;
    arms.push(`match(lower(${text}), {errorPattern${index}:String}), {errorCode${index}:String}`);
  });
  return { sql: `multiIf(${arms.join(", ")}, {errorOtherCode:String})`, params };
}

/**
 * Conservative allowlist screen over Vega expression strings. Refusing unknown
 * identifiers until reviewed and added.
 */

/**
 * Allowed identifiers—everything else fails closed. Deliberately excludes access
 * to other datasets, interaction, console, browser environment, nondeterministic
 * functions, regex, unrendered surfaces.
 */
export const ALLOWED_VEGA_EXPRESSION_IDENTIFIERS: readonly string[] = [
  // Literals the tokenizer sees as identifiers.
  "true",
  "false",
  "null",
  "undefined",
  "NaN",
  "Infinity",
  // Bound data.
  "datum",
  "parent",
  // Numeric constants.
  "E",
  "LN2",
  "LN10",
  "LOG2E",
  "LOG10E",
  "MAX_VALUE",
  "MIN_VALUE",
  "PI",
  "SQRT1_2",
  "SQRT2",
  // Type checks and coercion.
  "isArray",
  "isBoolean",
  "isDate",
  "isDefined",
  "isNumber",
  "isObject",
  "isRegExp",
  "isString",
  "isValid",
  "toBoolean",
  "toDate",
  "toNumber",
  "toString",
  // Math.
  "abs",
  "acos",
  "asin",
  "atan",
  "atan2",
  "ceil",
  "clamp",
  "cos",
  "exp",
  "expm1",
  "floor",
  "hypot",
  "log",
  "log1p",
  "max",
  "min",
  "pow",
  "round",
  "sin",
  "sqrt",
  "tan",
  // Dates and times, local and UTC.
  "date",
  "datetime",
  "day",
  "dayofyear",
  "hours",
  "milliseconds",
  "minutes",
  "month",
  "quarter",
  "seconds",
  "time",
  "timezoneoffset",
  "utc",
  "utcdate",
  "utcday",
  "utcdayofyear",
  "utchours",
  "utcmilliseconds",
  "utcminutes",
  "utcmonth",
  "utcquarter",
  "utcseconds",
  "utcweek",
  "utcyear",
  "week",
  "year",
  // Formatting and parsing.
  "format",
  "timeFormat",
  "timeParse",
  "utcFormat",
  "utcParse",
  // Strings and arrays.
  "indexof",
  "join",
  "lastindexof",
  "length",
  "lower",
  "pad",
  "parseFloat",
  "parseInt",
  "replace",
  "reverse",
  "slice",
  "span",
  "split",
  "substring",
  "trim",
  "truncate",
  "upper",
  // Control.
  "if",
];

const ALLOWED_IDENTIFIER_SET = new Set(ALLOWED_VEGA_EXPRESSION_IDENTIFIERS);

/** Quoted string literals, including escapes, in either quote style. */
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;

/** A property access — the field name after a dot belongs to the data, not to us. */
const MEMBER_ACCESS = /\.\s*[A-Za-z_$][A-Za-z0-9_$]*/g;

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Decimal and exponent numeric literals (removed first so 1e6 doesn't read as
 * identifier e6). Hex deliberately absent—Vega doesn't support it.
 */
const NUMERIC_LITERAL = /(?<![A-Za-z0-9_$])(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/g;

/** Every character an expression may contain once its string literals are gone. */
const DISALLOWED_CHARACTER = /[^A-Za-z0-9_$.,()[\]{}+\-*/%<>=!?:&|^~\s]/g;

/**
 * A bare `=` — assignment, or the head of an arrow function. `==`, `===`, `!=`,
 * `!==`, `<=` and `>=` are all excluded by the lookaround.
 */
const ASSIGNMENT = /(?<![=!<>])=(?!=)/;

export interface VegaExpressionScreening {
  /** Named functions or variables outside the allowlist. */
  readonly forbiddenIdentifiers: readonly string[];
  /** Syntax outside the allowlist, described for a repairable message. */
  readonly forbiddenConstructs: readonly string[];
}

/**
 * Screens one expression string; an empty result on both lists means it uses
 * only allowlisted identifiers, arithmetic, comparison, ternaries and its own
 * datum. Fields reached through `datum.` are NOT screened — they are data.
 */
export function screenVegaExpression(expression: string): VegaExpressionScreening {
  const withoutStrings = expression.replace(STRING_LITERAL, "0");

  const forbiddenConstructs: string[] = [];
  const badCharacters = withoutStrings.match(DISALLOWED_CHARACTER);
  if (badCharacters) {
    forbiddenConstructs.push(
      ...[...new Set(badCharacters)].map((c) => `character ${JSON.stringify(c)}`),
    );
  }
  if (ASSIGNMENT.test(withoutStrings)) {
    forbiddenConstructs.push("assignment or arrow function");
  }

  const withoutMembers = withoutStrings.replace(NUMERIC_LITERAL, "0").replace(MEMBER_ACCESS, "");
  const forbiddenIdentifiers = [...new Set(withoutMembers.match(IDENTIFIER) ?? [])].filter(
    (name) => !ALLOWED_IDENTIFIER_SET.has(name),
  );

  return { forbiddenIdentifiers, forbiddenConstructs };
}

/**
 * Every key where Vega-Lite hands expressions to the evaluator. signal is
 * screened (Vega's spelling), labelExpr is screened (axes/legends/headers use
 * it). Missing keys = no screening.
 */
export const EXPRESSION_BEARING_KEYS: readonly string[] = [
  "expr",
  "calculate",
  "filter",
  "signal",
  "labelExpr",
  // A conditional encoding carries its expression here — `{condition: {test:
  // "...", value: "red"}}`. Omitting it left a slot that reaches the same
  // evaluator as `filter` while never being screened, so an expression refused
  // as a filter was accepted verbatim as a condition.
  "test",
];

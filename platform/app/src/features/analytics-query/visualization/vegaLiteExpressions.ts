/**
 * The conservative screen over Vega expression strings.
 *
 * Vega's expression language is a real evaluator with access to scales, other
 * datasets, the browser environment, and the console. The screen is an
 * allowlist, not a denylist: anything not named here is refused until someone
 * reviews it and adds it. Extending `ALLOWED_VEGA_EXPRESSION_IDENTIFIERS` is the
 * intended way to widen it.
 */

/**
 * Identifiers an expression may name. Everything else fails closed.
 *
 * Deliberately absent, and why:
 *   - `data`, `indata`, `scale`, `invert`, `copy`, `bandwidth`, `bandspace` —
 *     reach other datasets and scales, walking around the registered-dataset rule.
 *   - `event`, `item` — interaction objects that carry DOM nodes and the view.
 *   - `warn`, `error`, `info`, `debug` — console side effects.
 *   - `screen`, `windowSize`, `containerSize`, `pinchDistance`, `pinchAngle` —
 *     probe the browser environment.
 *   - `now`, `random` — nondeterministic, so the same result would chart differently.
 *   - `regexp`, `test` — caller-authored regular expressions.
 *   - `rgb`, `hsl`, `lab`, `hcl`, `gradient`, `scheme`, `luminance`, `contrast` —
 *     colour is the application's theme to decide, not the spec's.
 *   - `vlSelectionTest`, `vlSelectionResolve`, `treePath`, `treeAncestors`,
 *     `merge`, `pluck`, `sequence`, `inScope`, the `pan*`/`zoom*` family, and the
 *     `geo*` family — surfaces this workbench does not render.
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
 * Screens one expression string. An empty result on both lists means the
 * expression uses nothing but allowlisted identifiers, arithmetic, comparison,
 * ternaries, and access to its own datum.
 *
 * Field names reached through `datum.` are NOT screened here: they are data,
 * and the dataset that feeds the branch decides whether they exist.
 */
export function screenVegaExpression(
  expression: string,
): VegaExpressionScreening {
  const withoutStrings = expression.replace(STRING_LITERAL, "0");

  const forbiddenConstructs: string[] = [];
  const badCharacters = withoutStrings.match(DISALLOWED_CHARACTER);
  if (badCharacters) {
    forbiddenConstructs.push(
      ...[...new Set(badCharacters)].map(
        (c) => `character ${JSON.stringify(c)}`,
      ),
    );
  }
  if (ASSIGNMENT.test(withoutStrings)) {
    forbiddenConstructs.push("assignment or arrow function");
  }

  const withoutMembers = withoutStrings.replace(MEMBER_ACCESS, "");
  const forbiddenIdentifiers = [
    ...new Set(withoutMembers.match(IDENTIFIER) ?? []),
  ].filter((name) => !ALLOWED_IDENTIFIER_SET.has(name));

  return { forbiddenIdentifiers, forbiddenConstructs };
}

/**
 * Every key whose value Vega-Lite hands to the expression evaluator.
 *
 * `expr`, `calculate`, and the string form of `filter` (including inside
 * `and`/`or`/`not` predicate composition) are the documented three. `signal` is
 * screened too — it is Vega's spelling, and a spec that smuggles one in should
 * not get a free pass. `labelExpr` is the fourth: axes, legends and headers each
 * carry one and it is evaluated exactly like the rest, so leaving it off this
 * list let a spec run an unscreened expression under a tick label, past both
 * expression byte ceilings as well.
 *
 * A key missing here is not a lesser refusal — it is no screening at all, which
 * is why this list is the one place the set is written.
 */
export const EXPRESSION_BEARING_KEYS = [
  "expr",
  "calculate",
  "filter",
  "signal",
  "labelExpr",
] as const;

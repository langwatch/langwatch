/**
 * What an app function's arguments have to be, checked before anything runs.
 *
 * Pure: it reads the catalog entry and the parsed argument nodes and answers
 * with the option values or with one sentence saying what is wrong. The walk in
 * `./validate.ts` is what turns that sentence into a violation, so this module
 * needs no frame, no context and no knowledge of how a refusal is reported.
 *
 * Every option must be a **literal**. The hydration plan is built before a
 * single row comes back, so an option read from a column would make one output
 * column mean different things in different rows of the same result. The key,
 * by contrast, is any expression the policy already admits.
 *
 * The literal shapes come from `@clickhouse/parser`: a scalar is
 * `{ value_type, value }` with `value` always a string, and an array is
 * `{ value_type: "Array", value: [{ value_type, value }, …] }`.
 *
 * @see ./validate.ts
 * @see ../appFunctions/catalog.ts
 * @see ../../../../../specs/lwql/eval-functions.feature
 */

import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "~/server/app-layer/instant-evals/classifier/token-budget";
import type {
  LangWatchQLAppFunctionDefinition,
  LangWatchQLAppFunctionParameter,
} from "../appFunctions/catalog";
import { lwqlAppFunctionSignature } from "../appFunctions/catalog";
import type { LangWatchQLAppFunctionOption } from "../appFunctions/plan";
import { echoIdentifier } from "./violations";

/** The option values, or the one sentence that says what is wrong. */
export type AppFunctionArgumentsOutcome =
  | { readonly ok: true; readonly options: LangWatchQLAppFunctionOption[] }
  | { readonly ok: false; readonly message: string };

/** The default bounds for a numeric option: a positive whole number. */
const DEFAULT_NUMERIC = {
  min: 1,
  max: Number.MAX_SAFE_INTEGER,
  isInteger: true,
};

/**
 * Most levels a score range may ask the classifier to weigh.
 *
 * The classifier's own ceiling, published by its limits rather than restated
 * here: a range of 0 to 10 is eleven levels, which the live API refuses with
 * `Too many score levels. Must have at most 10 levels.` Refusing it here is
 * what turns that into one message about the statement instead of one failed
 * request per row.
 */
const MAX_SCORE_LEVELS = INSTANT_EVAL_CLASSIFIER_LIMITS.maxScoreLevels;

export function readAppFunctionArguments({
  definition,
  args,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  args: readonly unknown[];
}): AppFunctionArgumentsOutcome {
  if (args.length !== definition.parameters.length) {
    return { ok: false, message: wrongArityMessage(definition) };
  }

  const options: LangWatchQLAppFunctionOption[] = [];
  for (const [index, parameter] of definition.parameters.entries()) {
    if (parameter.role === "key") continue;
    const value = readOption({ node: args[index], parameter });
    if (value === null) {
      return {
        ok: false,
        message: badOptionMessage({ definition, parameter }),
      };
    }
    options.push(value);
  }

  const acrossOptions = checkAcrossOptions({ definition, options });
  if (acrossOptions) return { ok: false, message: acrossOptions };
  return { ok: true, options };
}

/**
 * The arity message, which for `eval` also names the function that takes the
 * argument the caller was reaching for.
 *
 * `eval(text, instructions, criteria)` is the spelling both the design and a
 * reader's intuition reach for first, and it cannot exist: a ClickHouse SQL UDF
 * is a lambda with a fixed parameter list. Saying only "takes exactly 2
 * arguments" would leave the caller with no way to express criteria at all.
 */
function wrongArityMessage(
  definition: LangWatchQLAppFunctionDefinition,
): string {
  const count = definition.parameters.length;
  const plural = count === 1 ? "" : "s";
  const base = `The function "${echoIdentifier(definition.name)}" takes exactly ${count} argument${plural}: write it as "${lwqlAppFunctionSignature(definition)}".`;
  return definition.name === "eval"
    ? `${base} To say what counts as yes and what does not, call "eval_criteria(text, instructions, criteria)" instead.`
    : base;
}

function badOptionMessage({
  definition,
  parameter,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  parameter: LangWatchQLAppFunctionParameter;
}): string {
  return `The "${echoIdentifier(parameter.name)}" argument of "${echoIdentifier(definition.name)}" must be ${expectedShape(parameter)}, written directly in the query rather than read from a column or a bound parameter.`;
}

function expectedShape(parameter: LangWatchQLAppFunctionParameter): string {
  if (parameter.type === "string") {
    return (parameter.minLength ?? 0) > 0 ? "text, and not empty" : "text";
  }
  if (parameter.type === "number") return numericShape(parameter);
  const items = parameter.items ?? { min: 1, max: 255 };
  const entries =
    items.min === items.max
      ? `exactly ${items.min} entries`
      : `between ${items.min} and ${items.max} entries`;
  const shape =
    items.shape === "name-and-description"
      ? ", each written as `name: what it means`"
      : "";
  return `a list of text with ${entries}${shape}`;
}

function numericShape(parameter: LangWatchQLAppFunctionParameter): string {
  const numeric = parameter.numeric ?? DEFAULT_NUMERIC;
  const whole = numeric.isInteger ? "whole " : "";
  return numeric.max === Number.MAX_SAFE_INTEGER
    ? `a positive ${whole}number`
    : `a ${whole}number between ${numeric.min} and ${numeric.max}`;
}

// ---------------------------------------------------------------------------
// One option
// ---------------------------------------------------------------------------

function readOption({
  node,
  parameter,
}: {
  node: unknown;
  parameter: LangWatchQLAppFunctionParameter;
}): LangWatchQLAppFunctionOption | null {
  const literal = asLiteral(node);
  if (!literal) return null;
  if (parameter.type === "string") return textLiteral({ literal, parameter });
  if (parameter.type === "number") return numberLiteral({ literal, parameter });
  return listLiteral({ literal, parameter });
}

interface Literal {
  readonly valueType: string;
  readonly value: unknown;
}

function asLiteral(node: unknown): Literal | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return null;
  }
  const {
    type,
    value_type: valueType,
    value,
  } = node as Record<string, unknown>;
  if (type !== "Literal" || typeof valueType !== "string") return null;
  return { valueType, value };
}

function textLiteral({
  literal,
  parameter,
}: {
  literal: Literal;
  parameter: LangWatchQLAppFunctionParameter;
}): string | null {
  if (literal.valueType !== "String" || typeof literal.value !== "string") {
    return null;
  }
  const minLength = parameter.minLength ?? 0;
  return literal.value.trim().length < minLength ? null : literal.value;
}

/**
 * A number option, inside the bounds its parameter declares.
 *
 * The parser reports every scalar literal's value as a string and its kind as
 * `value_type`, so a number is recognised by that type being anything other
 * than `String` — rather than by a list of numeric type names that a parser
 * release could add to.
 */
function numberLiteral({
  literal,
  parameter,
}: {
  literal: Literal;
  parameter: LangWatchQLAppFunctionParameter;
}): number | null {
  if (literal.valueType === "String") return null;
  const { value } = literal;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const numeric = parameter.numeric ?? DEFAULT_NUMERIC;
  if (numeric.isInteger && !Number.isInteger(parsed)) return null;
  if (parsed < numeric.min || parsed > numeric.max) return null;
  return parsed;
}

function listLiteral({
  literal,
  parameter,
}: {
  literal: Literal;
  parameter: LangWatchQLAppFunctionParameter;
}): string[] | null {
  if (literal.valueType !== "Array" || !Array.isArray(literal.value)) {
    return null;
  }
  const items = parameter.items ?? { min: 1, max: 255 };
  if (literal.value.length < items.min || literal.value.length > items.max) {
    return null;
  }
  const entries: string[] = [];
  for (const element of literal.value) {
    const entry = listEntry({ element, shape: items.shape });
    if (entry === null) return null;
    entries.push(entry);
  }
  return entries;
}

function listEntry({
  element,
  shape,
}: {
  element: unknown;
  shape?: "name-and-description";
}): string | null {
  if (typeof element !== "object" || element === null) return null;
  const { value_type: valueType, value } = element as Record<string, unknown>;
  if (valueType !== "String" || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (shape === "name-and-description" && !isNameAndDescription(trimmed)) {
    return null;
  }
  return trimmed;
}

/** `name: what it means`, with something on both sides of the first colon. */
function isNameAndDescription(entry: string): boolean {
  const colon = entry.indexOf(":");
  if (colon <= 0) return false;
  return entry.slice(colon + 1).trim() !== "";
}

// ---------------------------------------------------------------------------
// Rules that span two options
// ---------------------------------------------------------------------------

/**
 * The one rule a single parameter cannot state: a score range runs upwards, and
 * not for ever.
 *
 * Each level is an option the classifier weighs, and it takes at most
 * {@link MAX_SCORE_LEVELS} of them, which is far fewer than a category's.
 */
function checkAcrossOptions({
  definition,
  options,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
}): string | null {
  if (definition.judgement?.kind !== "score") return null;
  // `[instructions, min, max]` — the key is not an option and never appears.
  const [, min, max] = options;
  if (typeof min !== "number" || typeof max !== "number") return null;
  if (max <= min) {
    return `The scale of "${echoIdentifier(definition.name)}" must run upwards: its highest level has to be above its lowest.`;
  }
  if (max - min + 1 > MAX_SCORE_LEVELS) {
    return `The scale of "${echoIdentifier(definition.name)}" may hold at most ${MAX_SCORE_LEVELS} levels, so its two ends may be at most ${MAX_SCORE_LEVELS - 1} apart.`;
  }
  return null;
}

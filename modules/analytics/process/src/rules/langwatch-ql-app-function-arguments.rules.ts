/**
 * What an app function's arguments have to be: the option values out, or one
 * sentence saying what is wrong. Every option must be a literal, because the
 * plan is built before a row comes back. @see specs/lwql/eval-functions.feature
 */

import type { LangWatchQLAppFunctionOption } from "@langwatch/analytics-contract";

import { lwqlAppFunctionSignature } from "./langwatch-ql-app-function-catalog.rules.ts";
import type {
  LangWatchQLAppFunctionDefinition,
  LangWatchQLAppFunctionParameter,
} from "./langwatch-ql-app-function-shapes.rules.ts";
import { LWQL_MAX_SCORE_LEVELS } from "./langwatch-ql-eval-function-catalog.rules.ts";
import { echoIdentifier } from "./langwatch-ql-violations.rules.ts";

/** The option values, or the one sentence that says what is wrong. */
export type AppFunctionArgumentsOutcome =
  | { readonly ok: true; readonly options: LangWatchQLAppFunctionOption[] }
  | { readonly ok: false; readonly message: string };

/** One option as it was read: the value, or the fact that it was refused. */
type OptionRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const REFUSED = { ok: false } as const;

/** The default bounds for a numeric option: a positive whole number. */
const DEFAULT_NUMERIC = {
  min: 1,
  max: Number.MAX_SAFE_INTEGER,
  isInteger: true,
};

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
    const read = readOption({ node: args[index], parameter });
    if (!read.ok) {
      return { ok: false, message: badOptionMessage({ definition, parameter }) };
    }
    options.push(read.value);
  }

  const acrossOptions = checkAcrossOptions({ definition, options });
  if (!acrossOptions.ok) return acrossOptions;
  return { ok: true, options };
}

/**
 * The arity message, which for `eval` also names the function that does take
 * the argument reached for: a SQL UDF has a fixed parameter list, so the
 * three-argument spelling cannot exist and the count alone would not say that.
 */
function wrongArityMessage(definition: LangWatchQLAppFunctionDefinition): string {
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
    items.shape === "name-and-description" ? ", each written as `name: what it means`" : "";
  return `a list of text with ${entries}${shape}`;
}

function numericShape(parameter: LangWatchQLAppFunctionParameter): string {
  const numeric = parameter.numeric ?? DEFAULT_NUMERIC;
  const whole = numeric.isInteger ? "whole " : "";
  return numeric.max === Number.MAX_SAFE_INTEGER
    ? `a positive ${whole}number`
    : `a ${whole}number between ${numeric.min} and ${numeric.max}`;
}

interface Literal {
  readonly valueType: string;
  readonly value: unknown;
}

function readOption({
  node,
  parameter,
}: {
  node: unknown;
  parameter: LangWatchQLAppFunctionParameter;
}): OptionRead<LangWatchQLAppFunctionOption> {
  const literal = asLiteral(node);
  if (!literal) return REFUSED;
  if (parameter.type === "string") return textLiteral({ literal, parameter });
  if (parameter.type === "number") return numberLiteral({ literal, parameter });
  return listLiteral({ literal, parameter });
}

/**
 * The parser's literal shape: a scalar is `{ value_type, value }` with `value`
 * always a string, and an array carries its elements in the same shape.
 */
function asLiteral(node: unknown): Literal | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
  const { type, value_type: valueType, value } = node as Record<string, unknown>;
  if (type !== "Literal" || typeof valueType !== "string") return null;
  return { valueType, value };
}

function textLiteral({
  literal,
  parameter,
}: {
  literal: Literal;
  parameter: LangWatchQLAppFunctionParameter;
}): OptionRead<string> {
  if (literal.valueType !== "String" || typeof literal.value !== "string") return REFUSED;
  const minLength = parameter.minLength ?? 0;
  if (literal.value.trim().length < minLength) return REFUSED;
  return { ok: true, value: literal.value };
}

/**
 * A number option, inside the bounds its parameter declares. Recognised by the
 * value type being anything other than `String`, rather than by a list of
 * numeric type names a parser release could add to.
 */
function numberLiteral({
  literal,
  parameter,
}: {
  literal: Literal;
  parameter: LangWatchQLAppFunctionParameter;
}): OptionRead<number> {
  if (literal.valueType === "String") return REFUSED;
  const { value } = literal;
  if (typeof value !== "string" && typeof value !== "number") return REFUSED;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return REFUSED;
  const numeric = parameter.numeric ?? DEFAULT_NUMERIC;
  if (numeric.isInteger && !Number.isInteger(parsed)) return REFUSED;
  if (parsed < numeric.min || parsed > numeric.max) return REFUSED;
  return { ok: true, value: parsed };
}

function listLiteral({
  literal,
  parameter,
}: {
  literal: Literal;
  parameter: LangWatchQLAppFunctionParameter;
}): OptionRead<string[]> {
  if (literal.valueType !== "Array" || !Array.isArray(literal.value)) return REFUSED;
  const items = parameter.items ?? { min: 1, max: 255 };
  if (literal.value.length < items.min || literal.value.length > items.max) return REFUSED;
  const entries: string[] = [];
  for (const element of literal.value) {
    const entry = listEntry({
      element,
      ...(items.shape === undefined ? {} : { shape: items.shape }),
    });
    if (!entry.ok) return REFUSED;
    entries.push(entry.value);
  }
  return { ok: true, value: entries };
}

function listEntry({
  element,
  shape,
}: {
  element: unknown;
  shape?: "name-and-description";
}): OptionRead<string> {
  if (typeof element !== "object" || element === null) return REFUSED;
  const { value_type: valueType, value } = element as Record<string, unknown>;
  if (valueType !== "String" || typeof value !== "string") return REFUSED;
  const trimmed = value.trim();
  if (trimmed === "") return REFUSED;
  if (shape === "name-and-description" && !isNameAndDescription(trimmed)) return REFUSED;
  return { ok: true, value: trimmed };
}

/** `name: what it means`, with something on both sides of the first colon. */
function isNameAndDescription(entry: string): boolean {
  const colon = entry.indexOf(":");
  if (colon <= 0) return false;
  return entry.slice(colon + 1).trim() !== "";
}

/**
 * The one rule a single parameter cannot state: a score range runs upwards,
 * and not for ever — each level is an option the judge weighs.
 */
function checkAcrossOptions({
  definition,
  options,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
}): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (definition.judgement?.kind !== "score") return { ok: true };
  // `[instructions, min, max]` — the key is not an option and never appears.
  const [, min, max] = options;
  if (typeof min !== "number" || typeof max !== "number") return { ok: true };
  if (max <= min) {
    return {
      ok: false,
      message: `The scale of "${echoIdentifier(definition.name)}" must run upwards: its highest level has to be above its lowest.`,
    };
  }
  if (max - min + 1 > LWQL_MAX_SCORE_LEVELS) {
    return {
      ok: false,
      message: `The scale of "${echoIdentifier(definition.name)}" may hold at most ${LWQL_MAX_SCORE_LEVELS} levels, so its two ends may be at most ${LWQL_MAX_SCORE_LEVELS - 1} apart.`,
    };
  }
  return { ok: true };
}

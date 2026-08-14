/**
 * The reviewed transform set: what each step reads, and what it leaves behind.
 *
 * This table is the single definition of the set. The policy's allowlist is its
 * keys, so a transform can never be permitted without an analyzer — which would
 * contribute no columns and turn a working chart into an unknown-field refusal
 * blaming the wrong thing entirely.
 *
 * Its own module because both the policy and the field walk read it, and the
 * field walk already reads the policy's error builder.
 */

import { isPlainObject, visitPredicate } from "./vegaLiteStructure";

/** What one transform step reads and what it leaves behind. */
export interface TransformEffect {
  readonly consumes: readonly string[];
  readonly produces: readonly string[];
  /** True when the step's output columns are only knowable from the data. */
  readonly isUnverifiable: boolean;
}

/**
 * Per-transform reads and writes, keyed by the signature key a step declares.
 *
 * Deliberately shorter than Vega-Lite's own set: `density`, `regression`,
 * `loess`, `quantile`, `impute`, `sample`, `extent` and the generators are
 * absent — and so refused — because nothing here bounds what they cost or what
 * they emit.
 */
export const TRANSFORM_ANALYZERS: Record<
  string,
  (step: Record<string, unknown>) => TransformEffect
> = {
  filter: (step) => ({
    consumes: predicateFields(step.filter),
    produces: [],
    isUnverifiable: false,
  }),
  calculate: (step) => ({
    consumes: [],
    produces: stringList(step.as),
    isUnverifiable: false,
  }),
  aggregate: (step) => ({
    consumes: [...opFields(step.aggregate), ...stringList(step.groupby)],
    produces: [...opOutputs(step.aggregate), ...stringList(step.groupby)],
    isUnverifiable: false,
  }),
  bin: (step) => ({
    consumes: stringList(step.field),
    produces: binOutputs(step),
    isUnverifiable: false,
  }),
  timeUnit: (step) => ({
    consumes: stringList(step.field),
    produces: stringList(step.as),
    isUnverifiable: false,
  }),
  stack: (step) => ({
    consumes: [...stringList(step.stack), ...stringList(step.groupby)],
    produces: stackOutputs(step),
    isUnverifiable: false,
  }),
  fold: (step) => ({
    consumes: stringList(step.fold),
    produces:
      stringList(step.as).length > 0 ? stringList(step.as) : ["key", "value"],
    isUnverifiable: false,
  }),
  flatten: (step) => ({
    consumes: stringList(step.flatten),
    produces: [...stringList(step.as), ...stringList(step.flatten)],
    isUnverifiable: false,
  }),
  lookup: (step) => ({
    consumes: stringList(step.lookup),
    produces: lookupOutputs(step),
    isUnverifiable: false,
  }),
  joinaggregate: (step) => ({
    consumes: [...opFields(step.joinaggregate), ...stringList(step.groupby)],
    produces: opOutputs(step.joinaggregate),
    isUnverifiable: false,
  }),
  window: (step) => ({
    consumes: [...opFields(step.window), ...stringList(step.groupby)],
    produces: opOutputs(step.window),
    isUnverifiable: false,
  }),
  pivot: (step) => ({
    consumes: [
      ...stringList(step.pivot),
      ...stringList(step.value),
      ...stringList(step.groupby),
    ],
    produces: stringList(step.groupby),
    isUnverifiable: true,
  }),
};

/**
 * Reads the effect of one transform step, off the first signature key the table
 * carries.
 *
 * A step the table does not recognise consumes and produces nothing, which is
 * the conservative reading — and unreachable through the validator, whose
 * allowlist is this table's own keys.
 */
export function analyzeTransform(
  step: Record<string, unknown>,
): TransformEffect {
  for (const [name, analyze] of Object.entries(TRANSFORM_ANALYZERS)) {
    if (name in step) return analyze(step);
  }
  return { consumes: [], produces: [], isUnverifiable: false };
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string");
  return [];
}

/** `field` on each entry of an `aggregate`/`window`/`joinaggregate` op list. */
function opFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isPlainObject(entry) ? stringList(entry.field) : [],
  );
}

function opOutputs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isPlainObject(entry) ? stringList(entry.as) : [],
  );
}

function binOutputs(step: Record<string, unknown>): string[] {
  const named = stringList(step.as);
  if (named.length > 0)
    return [...named, ...named.map((name) => `${name}_end`)];
  return stringList(step.field).flatMap((field) => [
    `bin_${field}`,
    `bin_${field}_end`,
  ]);
}

function stackOutputs(step: Record<string, unknown>): string[] {
  const named = stringList(step.as);
  if (named.length > 0)
    return [...named, ...named.map((name) => `${name}_end`)];
  return stringList(step.stack).flatMap((field) => [
    `${field}_start`,
    `${field}_end`,
  ]);
}

function lookupOutputs(step: Record<string, unknown>): string[] {
  const from = step.from;
  if (!isPlainObject(from)) return stringList(step.as);
  return [
    ...stringList(step.as),
    ...stringList(from.fields),
    ...stringList(from.as),
  ];
}

/** Field names a filter predicate reads, including its nested branches. */
function predicateFields(predicate: unknown): string[] {
  const fields: string[] = [];
  visitPredicate({
    predicate,
    visit: ({ value }) => {
      if (isPlainObject(value)) fields.push(...stringList(value.field));
    },
  });
  return fields;
}

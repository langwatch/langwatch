/**
 * Field-reference validation, resolved against the dataset that actually feeds
 * each branch of the composition tree.
 *
 * Two deliberate choices, both to keep false refusals out of a member's way:
 *
 *   1. Transforms are treated as ADDITIVE. `aggregate` really does drop the
 *      columns it does not carry forward, but modelling that exactly would
 *      refuse working charts whenever this walk is a step behind Vega-Lite's
 *      own semantics. A reference to a dropped column renders empty; it is not
 *      a containment problem, and the row and view ceilings are what bound cost.
 *   2. `pivot` names its output columns after DATA VALUES, so nothing static can
 *      enumerate them. A branch downstream of a pivot reports unknown fields as
 *      warnings rather than refusals — see `transform-fields-unverifiable`.
 *
 * Expressions are not field-checked at all: `datum.foo` inside a `calculate` is
 * data, and the expression screen in `vegaLiteExpressions.ts` deliberately stops
 * at the dot.
 */

import { governedVegaError } from "./vegaLitePolicy";
import {
  compositionChildrenOf,
  isPlainObject,
  JSON_POINTER_ROOT,
  joinPointer,
  repeatFieldsOf,
} from "./vegaLiteStructure";
import type {
  GovernedDatasetColumn,
  VegaValidationError,
  VegaValidationWarning,
} from "./visualization.types";

export type ColumnsByDataset = Readonly<
  Record<string, readonly GovernedDatasetColumn[]>
>;

export interface FieldValidationOutcome {
  readonly errors: readonly VegaValidationError[];
  readonly warnings: readonly VegaValidationWarning[];
}

/** What one transform step reads and what it leaves behind. */
interface TransformEffect {
  readonly consumes: readonly string[];
  readonly produces: readonly string[];
  /** True when the step's output columns are only knowable from the data. */
  readonly unverifiable: boolean;
}

interface BranchScope {
  readonly datasetName: string | null;
  readonly available: ReadonlySet<string>;
  readonly unverifiable: boolean;
  readonly repeatFields: Readonly<Record<string, readonly string[]>>;
}

/**
 * One field reference found in the spec, with the pointer that reaches it.
 * `repeat` form stands for every field in the enclosing repeat list.
 */
interface FieldReference {
  readonly path: string;
  readonly field: string | { readonly repeat: string };
}

/**
 * Validates every field reference in the spec against the dataset feeding its
 * branch. Assumes the policy walk already established that each branch resolves
 * to a registered dataset.
 */
export function validateFieldReferences({
  spec,
  columnsByDataset,
}: {
  spec: unknown;
  columnsByDataset: ColumnsByDataset;
}): FieldValidationOutcome {
  const errors: VegaValidationError[] = [];
  const warnings: VegaValidationWarning[] = [];

  walkBranch({
    node: spec,
    path: JSON_POINTER_ROOT,
    scope: {
      datasetName: null,
      available: new Set(),
      unverifiable: false,
      repeatFields: {},
    },
    columnsByDataset,
    errors,
    warnings,
  });

  return { errors, warnings };
}

function walkBranch({
  node,
  path,
  scope,
  columnsByDataset,
  errors,
  warnings,
}: {
  node: unknown;
  path: string;
  scope: BranchScope;
  columnsByDataset: ColumnsByDataset;
  errors: VegaValidationError[];
  warnings: VegaValidationWarning[];
}): void {
  if (!isPlainObject(node)) return;

  let current = rebaseOnOwnData({ node, scope, columnsByDataset });
  current = applyTransforms({ node, path, scope: current, errors, warnings });

  const references = [
    ...encodingReferences({ node, path }),
    ...facetReferences({ node, path }),
  ];
  reportUnknownFields({ references, scope: current, errors, warnings });

  for (const child of compositionChildrenOf({ node, path })) {
    walkBranch({
      ...child,
      scope: current,
      columnsByDataset,
      errors,
      warnings,
    });
  }
}

/** A node with its own `data` starts a fresh field set; otherwise it inherits. */
function rebaseOnOwnData({
  node,
  scope,
  columnsByDataset,
}: {
  node: Record<string, unknown>;
  scope: BranchScope;
  columnsByDataset: ColumnsByDataset;
}): BranchScope {
  const repeatFields = {
    ...scope.repeatFields,
    ...repeatFieldsOf(node.repeat),
  };
  const data = node.data;
  if (!isPlainObject(data) || typeof data.name !== "string") {
    return { ...scope, repeatFields };
  }

  const columns = columnsByDataset[data.name] ?? [];
  return {
    datasetName: data.name,
    available: new Set(columns.map((column) => column.name)),
    unverifiable: false,
    repeatFields,
  };
}

function applyTransforms({
  node,
  path,
  scope,
  errors,
  warnings,
}: {
  node: Record<string, unknown>;
  path: string;
  scope: BranchScope;
  errors: VegaValidationError[];
  warnings: VegaValidationWarning[];
}): BranchScope {
  const steps = node.transform;
  if (!Array.isArray(steps)) return scope;

  const listPath = joinPointer(path, "transform");
  let current = scope;

  steps.forEach((step, index) => {
    if (!isPlainObject(step)) return;
    const stepPath = joinPointer(listPath, index);
    const effect = analyzeTransform(step);

    reportUnknownFields({
      references: effect.consumes.map((field) => ({ path: stepPath, field })),
      scope: current,
      errors,
      warnings,
    });

    current = {
      ...current,
      available: new Set([...current.available, ...effect.produces]),
      unverifiable: current.unverifiable || effect.unverifiable,
    };
    if (effect.unverifiable) {
      warnings.push(unverifiableWarning(stepPath));
    }
  });

  return current;
}

function unverifiableWarning(path: string): VegaValidationWarning {
  return {
    code: "transform-fields-unverifiable",
    path,
    message:
      "This transform names its output columns after values in the data, so field names after it cannot be checked before the chart runs.",
  };
}

function reportUnknownFields({
  references,
  scope,
  errors,
  warnings,
}: {
  references: readonly FieldReference[];
  scope: BranchScope;
  errors: VegaValidationError[];
  warnings: VegaValidationWarning[];
}): void {
  for (const reference of references) {
    const resolved = resolveReference({ reference, scope });
    if (resolved.unboundRepeatVariable !== null) {
      errors.push(
        unboundRepeatError({
          path: reference.path,
          variable: resolved.unboundRepeatVariable,
        }),
      );
      continue;
    }

    reportMissingFields({
      fields: resolved.fields,
      path: reference.path,
      scope,
      errors,
      warnings,
    });
  }
}

/**
 * A missing field is a refusal, unless a transform upstream creates columns the
 * data names — then the only honest report is a warning, because the column may
 * well exist once the chart runs.
 */
function reportMissingFields({
  fields,
  path,
  scope,
  errors,
  warnings,
}: {
  fields: readonly string[];
  path: string;
  scope: BranchScope;
  errors: VegaValidationError[];
  warnings: VegaValidationWarning[];
}): void {
  for (const field of fields) {
    if (fieldIsKnown({ field, available: scope.available })) continue;
    if (scope.unverifiable) {
      warnings.push({
        code: "transform-fields-unverifiable",
        path,
        message: `"${field}" is not a column of ${describeDataset(scope)}, but a transform above it creates columns from the data, so this can only be checked when the chart runs.`,
      });
      continue;
    }
    errors.push(unknownFieldError({ path, field, scope }));
  }
}

function unboundRepeatError({
  path,
  variable,
}: {
  path: string;
  variable: string;
}): VegaValidationError {
  return governedVegaError({
    rule: "field.unknown",
    path,
    message: `This field reads the repeat variable "${variable}", which no enclosing repeat definition binds. Add it to the repeat list or name a column directly.`,
    meta: { repeatVariable: variable },
  });
}

function unknownFieldError({
  path,
  field,
  scope,
}: {
  path: string;
  field: string;
  scope: BranchScope;
}): VegaValidationError {
  const columns = [...scope.available].sort();
  return governedVegaError({
    rule: "field.unknown",
    path,
    message: `"${field}" is not a column of ${describeDataset(scope)}. Available columns: ${columns.join(", ") || "none"}.`,
    meta: { field, dataset: scope.datasetName, availableColumns: columns },
  });
}

function describeDataset(scope: BranchScope): string {
  return scope.datasetName === null
    ? "the dataset feeding this view"
    : `dataset "${scope.datasetName}"`;
}

/** Expands a `{"repeat": "column"}` reference into the fields it stands for. */
function resolveReference({
  reference,
  scope,
}: {
  reference: FieldReference;
  scope: BranchScope;
}): { fields: readonly string[]; unboundRepeatVariable: string | null } {
  if (typeof reference.field === "string") {
    return { fields: [reference.field], unboundRepeatVariable: null };
  }

  const variable = reference.field.repeat;
  const bound = scope.repeatFields[variable];
  if (bound === undefined) {
    return { fields: [], unboundRepeatVariable: variable };
  }
  return { fields: bound, unboundRepeatVariable: null };
}

function fieldIsKnown({
  field,
  available,
}: {
  field: string;
  available: ReadonlySet<string>;
}): boolean {
  if (available.has(field)) return true;

  // Vega-Lite escapes a literal dot in a column name as `\.`; unescaping gives
  // back the name the response actually carried.
  const literal = field.replace(/\\(.)/g, "$1");
  if (available.has(literal)) return true;

  // `a.b` and `a[0]` reach into a structured column, so the root has to exist
  // but the rest belongs to the value.
  const root = accessRootOf(field);
  return root !== field && available.has(root);
}

function accessRootOf(field: string): string {
  const match = /^(?:[^.[\\]|\\.)+/.exec(field);
  return match ? match[0] : field;
}

/** Field references carried by a node's `encoding` block. */
function encodingReferences({
  node,
  path,
}: {
  node: Record<string, unknown>;
  path: string;
}): FieldReference[] {
  const encoding = node.encoding;
  if (!isPlainObject(encoding)) return [];

  const encodingPath = joinPointer(path, "encoding");
  const references: FieldReference[] = [];
  for (const [channel, definition] of Object.entries(encoding)) {
    const channelPath = joinPointer(encodingPath, channel);
    for (const [index, entry] of channelEntries(definition).entries()) {
      const entryPath = Array.isArray(definition)
        ? joinPointer(channelPath, index)
        : channelPath;
      references.push(
        ...channelDefinitionReferences({ entry, path: entryPath }),
      );
    }
  }
  return references;
}

function channelEntries(definition: unknown): Record<string, unknown>[] {
  if (Array.isArray(definition)) return definition.filter(isPlainObject);
  return isPlainObject(definition) ? [definition] : [];
}

/** `field`, plus the nested `sort` and `condition` definitions that carry one. */
function channelDefinitionReferences({
  entry,
  path,
}: {
  entry: Record<string, unknown>;
  path: string;
}): FieldReference[] {
  const references: FieldReference[] = [];
  references.push(...fieldRefAt({ holder: entry, path }));

  const sort = entry.sort;
  if (isPlainObject(sort)) {
    references.push(
      ...fieldRefAt({ holder: sort, path: joinPointer(path, "sort") }),
    );
  }

  const conditionPath = joinPointer(path, "condition");
  for (const [index, condition] of channelEntries(entry.condition).entries()) {
    const holderPath = Array.isArray(entry.condition)
      ? joinPointer(conditionPath, index)
      : conditionPath;
    references.push(...fieldRefAt({ holder: condition, path: holderPath }));
  }

  return references;
}

/** Reads a `field`, which is either a name or a `{"repeat": <variable>}` binding. */
function fieldRefAt({
  holder,
  path,
}: {
  holder: Record<string, unknown>;
  path: string;
}): FieldReference[] {
  const field = holder.field;
  const fieldPath = joinPointer(path, "field");
  if (typeof field === "string") return [{ path: fieldPath, field }];
  if (isPlainObject(field) && typeof field.repeat === "string") {
    return [{ path: fieldPath, field: { repeat: field.repeat } }];
  }
  return [];
}

/** `facet`, `row` and `column` definitions carry field references of their own. */
function facetReferences({
  node,
  path,
}: {
  node: Record<string, unknown>;
  path: string;
}): FieldReference[] {
  const facet = node.facet;
  if (!isPlainObject(facet)) return [];

  const facetPath = joinPointer(path, "facet");
  const direct = fieldRefAt({ holder: facet, path: facetPath });
  const nested = ["row", "column"].flatMap((key) => {
    const definition = facet[key];
    return isPlainObject(definition)
      ? fieldRefAt({ holder: definition, path: joinPointer(facetPath, key) })
      : [];
  });

  return [...direct, ...nested];
}

/** Per-transform reads and writes. A step outside this table produces nothing. */
const TRANSFORM_ANALYZERS: Record<
  string,
  (step: Record<string, unknown>) => TransformEffect
> = {
  filter: (step) => ({
    consumes: predicateFields(step.filter),
    produces: [],
    unverifiable: false,
  }),
  calculate: (step) => ({
    consumes: [],
    produces: stringList(step.as),
    unverifiable: false,
  }),
  aggregate: (step) => ({
    consumes: [...opFields(step.aggregate), ...stringList(step.groupby)],
    produces: [...opOutputs(step.aggregate), ...stringList(step.groupby)],
    unverifiable: false,
  }),
  bin: (step) => ({
    consumes: stringList(step.field),
    produces: binOutputs(step),
    unverifiable: false,
  }),
  timeUnit: (step) => ({
    consumes: stringList(step.field),
    produces: stringList(step.as),
    unverifiable: false,
  }),
  stack: (step) => ({
    consumes: [...stringList(step.stack), ...stringList(step.groupby)],
    produces: stackOutputs(step),
    unverifiable: false,
  }),
  fold: (step) => ({
    consumes: stringList(step.fold),
    produces:
      stringList(step.as).length > 0 ? stringList(step.as) : ["key", "value"],
    unverifiable: false,
  }),
  flatten: (step) => ({
    consumes: stringList(step.flatten),
    produces: [...stringList(step.as), ...stringList(step.flatten)],
    unverifiable: false,
  }),
  lookup: (step) => ({
    consumes: stringList(step.lookup),
    produces: lookupOutputs(step),
    unverifiable: false,
  }),
  joinaggregate: (step) => ({
    consumes: [...opFields(step.joinaggregate), ...stringList(step.groupby)],
    produces: opOutputs(step.joinaggregate),
    unverifiable: false,
  }),
  window: (step) => ({
    consumes: [...opFields(step.window), ...stringList(step.groupby)],
    produces: opOutputs(step.window),
    unverifiable: false,
  }),
  pivot: (step) => ({
    consumes: [
      ...stringList(step.pivot),
      ...stringList(step.value),
      ...stringList(step.groupby),
    ],
    produces: stringList(step.groupby),
    unverifiable: true,
  }),
};

/**
 * Reads the effect of one transform step. The policy walk has already refused
 * anything outside the allowlist, so an unrecognised step here is a step whose
 * signature key the analyzer table does not carry — it consumes and produces
 * nothing, which is the conservative reading.
 */
export function analyzeTransform(
  step: Record<string, unknown>,
): TransformEffect {
  for (const [name, analyze] of Object.entries(TRANSFORM_ANALYZERS)) {
    if (name in step) return analyze(step);
  }
  return { consumes: [], produces: [], unverifiable: false };
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

/** Field names named directly by a filter predicate object. */
function predicateFields(predicate: unknown): string[] {
  if (!isPlainObject(predicate)) return [];

  const own = stringList(predicate.field);
  const nested = ["and", "or", "not"].flatMap((key) => {
    const branch = predicate[key];
    if (Array.isArray(branch)) return branch.flatMap(predicateFields);
    return predicateFields(branch);
  });

  return [...own, ...nested];
}

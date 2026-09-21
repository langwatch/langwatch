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

import { lwqlVegaError } from "./vegaLitePolicy";
import {
  collectViewNodes,
  isPlainObject,
  joinPointer,
  type VegaViewNode,
} from "./vegaLiteStructure";
import { analyzeTransform } from "./vegaLiteTransforms";
import type {
  LangWatchQLDatasetColumn,
  VegaValidationError,
  VegaValidationWarning,
} from "./visualization.types";

export type ColumnsByDataset = Readonly<
  Record<string, readonly LangWatchQLDatasetColumn[]>
>;

export interface FieldValidationOutcome {
  readonly errors: readonly VegaValidationError[];
  readonly warnings: readonly VegaValidationWarning[];
}

interface BranchScope {
  readonly datasetName: string | null;
  readonly available: ReadonlySet<string>;
  readonly isUnverifiable: boolean;
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
 *
 * The composition tree comes from `collectViewNodes`, which already resolves
 * inherited data and `repeat` scope; what this adds on top is the one thing
 * that is field-specific — the columns each branch's own transforms leave
 * behind. Nodes arrive parent-first, so a branch's inherited scope is always
 * resolved before the branch itself is read.
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
  const scopeByPath = new Map<string, BranchScope>();

  for (const view of collectViewNodes(spec)) {
    const inherited =
      view.parentPath === null
        ? null
        : (scopeByPath.get(view.parentPath) ?? null);

    const scope = applyTransforms({
      node: view.node,
      path: view.path,
      scope: startingScope({ view, inherited, columnsByDataset }),
      errors,
      warnings,
    });
    scopeByPath.set(view.path, scope);

    reportUnknownFields({
      references: [
        ...encodingReferences({ node: view.node, path: view.path }),
        ...facetReferences({ node: view.node, path: view.path }),
      ],
      scope,
      errors,
      warnings,
    });
  }

  return { errors, warnings };
}

/**
 * The field set a view starts from, before its own transforms run: a view that
 * names its own dataset restarts at that dataset's columns, and anything else
 * carries on with whatever its parent resolved.
 */
function startingScope({
  view,
  inherited,
  columnsByDataset,
}: {
  view: VegaViewNode;
  inherited: BranchScope | null;
  columnsByDataset: ColumnsByDataset;
}): BranchScope {
  const { declaredDatasetName, repeatFields } = view;

  if (declaredDatasetName === null) {
    return inherited === null
      ? {
          datasetName: null,
          available: new Set(),
          isUnverifiable: false,
          repeatFields,
        }
      : { ...inherited, repeatFields };
  }

  const columns = columnsByDataset[declaredDatasetName] ?? [];
  return {
    datasetName: declaredDatasetName,
    available: new Set(columns.map((column) => column.name)),
    isUnverifiable: false,
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
      isUnverifiable: current.isUnverifiable || effect.isUnverifiable,
    };
    if (effect.isUnverifiable) {
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
    if (scope.isUnverifiable) {
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
  return lwqlVegaError({
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
  return lwqlVegaError({
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

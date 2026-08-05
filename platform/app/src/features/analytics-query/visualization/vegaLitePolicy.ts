/**
 * The governed Vega-Lite policy: the ceilings, the allowlists, the rule
 * catalogue, and the fail-closed walk that applies them.
 *
 * Every ceiling is named here and nowhere else, so a refusal can say which one
 * it hit and a reviewer can see the whole envelope in one place.
 */

import {
  EXPRESSION_BEARING_KEYS,
  screenVegaExpression,
} from "./vegaLiteExpressions";
import {
  collectViewNodes,
  countUnitViews,
  isPlainObject,
  JSON_POINTER_ROOT,
  type JsonObjectNode,
  joinPointer,
  measureJsonDepth,
  measureSpecBytes,
  measureUtf8Bytes,
  visitJsonObjects,
} from "./vegaLiteStructure";
import {
  type DatasetRowCounts,
  GOVERNED_VEGA_RULE_IDS,
  type GovernedVegaRuleId,
  type VegaValidationError,
  type VegaValidationErrorCode,
  type VegaValidationWarning,
} from "./visualization.types";

/**
 * Every named ceiling, in one object. A chart that sits on a ceiling renders;
 * one past it is refused naming the ceiling it crossed.
 */
export const GOVERNED_VEGA_LIMITS = {
  /** Serialized specification size, in UTF-8 bytes. */
  maxSpecBytes: 262144,
  /** Depth of the JSON object/array tree. */
  maxNestingDepth: 32,
  /** Mark-drawing views, with `repeat` expanded by its list length. */
  maxUnitViews: 12,
  /** Entries in any single `layer` array. */
  maxLayersPerView: 8,
  /** Transform steps across the whole specification. */
  maxTransforms: 32,
  /** UTF-8 bytes in one expression string. */
  maxExpressionBytes: 4096,
  /** UTF-8 bytes across every expression string in the specification. */
  maxTotalExpressionBytes: 16384,
  /** Interactive parameters and selections across the whole specification. */
  maxInteractiveParams: 16,
  /** Rows in any one registered dataset. */
  maxRowsPerDataset: 10000,
  /** Rows across every registered dataset together. */
  maxRowsAllDatasets: 20000,
} as const;

export type GovernedVegaLimitName = keyof typeof GOVERNED_VEGA_LIMITS;

/**
 * Transforms whose behaviour and produced columns have been reviewed. The list
 * is deliberately shorter than Vega-Lite's: `density`, `regression`, `loess`,
 * `quantile`, `impute`, `sample`, `extent` and the generators are all refused
 * because nothing here bounds what they cost or what they emit.
 */
export const ALLOWED_VEGA_LITE_TRANSFORMS: readonly string[] = [
  "filter",
  "calculate",
  "aggregate",
  "bin",
  "timeUnit",
  "stack",
  "fold",
  "flatten",
  "lookup",
  "joinaggregate",
  "window",
  "pivot",
];

const ALLOWED_TRANSFORM_SET = new Set(ALLOWED_VEGA_LITE_TRANSFORMS);

export interface GovernedVegaRule {
  readonly id: GovernedVegaRuleId;
  readonly code: VegaValidationErrorCode;
  readonly summary: string;
}

/**
 * Keyed by the rule-id union, so a rule cannot be added to
 * `GOVERNED_VEGA_RULE_IDS` without the compiler demanding its entry here.
 */
const RULE_CATALOGUE: Record<
  GovernedVegaRuleId,
  { code: VegaValidationErrorCode; summary: string }
> = {
  "spec.not-json": {
    code: "invalid-json",
    summary: "The specification text must parse as JSON.",
  },
  "spec.not-object": {
    code: "spec-not-object",
    summary: "The specification must be a JSON object, not a URL or a scalar.",
  },
  "spec.unsupported-schema-version": {
    code: "unsupported-schema-version",
    summary: "An explicit $schema must be Vega-Lite v6.",
  },
  "spec.schema-invalid": {
    code: "schema-failure",
    summary: "The specification must match the bundled Vega-Lite v6 schema.",
  },
  "data.caller-datasets": {
    code: "policy-rejection",
    summary: "A specification may not define its own datasets.",
  },
  "data.inline-values": {
    code: "policy-rejection",
    summary: "A data source may not carry inline values.",
  },
  "data.url": {
    code: "policy-rejection",
    summary: "A data source may not load from a URL.",
  },
  "data.unknown-name": {
    code: "unknown-dataset",
    summary: "A data source must name a registered dataset.",
  },
  "data.unresolved": {
    code: "unknown-dataset",
    summary: "Every view must resolve to a registered dataset.",
  },
  "lookup.url-data": {
    code: "policy-rejection",
    summary: "A lookup may not read from a URL.",
  },
  "lookup.inline-data": {
    code: "policy-rejection",
    summary: "A lookup may not read inline values.",
  },
  "mark.image": {
    code: "policy-rejection",
    summary: "Image marks load remote resources and are refused.",
  },
  "encoding.url": {
    code: "policy-rejection",
    summary: "The url encoding channel loads remote resources and is refused.",
  },
  "resource.url-property": {
    code: "policy-rejection",
    summary: "No property anywhere in a specification may carry a URL.",
  },
  "runtime.embed-options": {
    code: "policy-rejection",
    summary: "A specification may not set the chart runtime's own options.",
  },
  "transform.unknown": {
    code: "policy-rejection",
    summary: "Transforms outside the reviewed allowlist fail closed.",
  },
  "expression.forbidden": {
    code: "policy-rejection",
    summary: "Expressions outside the reviewed allowlist fail closed.",
  },
  "field.unknown": {
    code: "unknown-field",
    summary: "A field must exist in the dataset feeding its branch.",
  },
  "limit.maxSpecBytes": {
    code: "complexity-refusal",
    summary: "Specification size ceiling.",
  },
  "limit.maxNestingDepth": {
    code: "complexity-refusal",
    summary: "Nesting depth ceiling.",
  },
  "limit.maxUnitViews": {
    code: "complexity-refusal",
    summary: "Unit view ceiling.",
  },
  "limit.maxLayersPerView": {
    code: "complexity-refusal",
    summary: "Layers-per-view ceiling.",
  },
  "limit.maxTransforms": {
    code: "complexity-refusal",
    summary: "Transform count ceiling.",
  },
  "limit.maxExpressionBytes": {
    code: "complexity-refusal",
    summary: "Single expression size ceiling.",
  },
  "limit.maxTotalExpressionBytes": {
    code: "complexity-refusal",
    summary: "Total expression size ceiling.",
  },
  "limit.maxInteractiveParams": {
    code: "complexity-refusal",
    summary: "Interactive parameter ceiling.",
  },
  "limit.maxRowsPerDataset": {
    code: "complexity-refusal",
    summary: "Rows-per-dataset ceiling.",
  },
  "limit.maxRowsAllDatasets": {
    code: "complexity-refusal",
    summary: "Total rows ceiling.",
  },
  "loader.blocked": {
    code: "loader-blocked",
    summary: "The chart loader refuses every network and file load.",
  },
  "render.failure": {
    code: "render-failure",
    summary: "Vega failed to compile or run an accepted specification.",
  },
  "encoding.empty": {
    code: "empty-encoding",
    summary: "Every encoded value was empty or missing.",
  },
};

/** The full rule list, for review and for the tests that must cover each one. */
export const GOVERNED_VEGA_RULES: readonly GovernedVegaRule[] =
  GOVERNED_VEGA_RULE_IDS.map((id) => ({ id, ...RULE_CATALOGUE[id] }));

/** Builds a refusal, taking its presentation code from the rule catalogue. */
export function governedVegaError({
  rule,
  path,
  message,
  meta,
}: {
  rule: GovernedVegaRuleId;
  path: string;
  message: string;
  meta?: Readonly<Record<string, unknown>>;
}): VegaValidationError {
  return {
    code: RULE_CATALOGUE[rule].code,
    rule,
    path,
    message,
    ...(meta ? { meta } : {}),
  };
}

/** Builds a ceiling refusal whose message names the ceiling it crossed. */
function limitError({
  limit,
  path,
  actual,
  noun,
}: {
  limit: GovernedVegaLimitName;
  path: string;
  actual: number;
  noun: string;
}): VegaValidationError {
  const allowed = GOVERNED_VEGA_LIMITS[limit];
  return governedVegaError({
    rule: `limit.${limit}` as GovernedVegaRuleId,
    path,
    message: `This chart uses ${actual} ${noun}, past the ${limit} limit of ${allowed}. Simplify the specification or narrow the query.`,
    meta: { limit, allowed, actual },
  });
}

/**
 * Size and depth, checked before the schema so that an adversarially large or
 * deep document is refused without ever being handed to the schema validator.
 */
export function checkSpecEnvelopeLimits(spec: unknown): VegaValidationError[] {
  const errors: VegaValidationError[] = [];

  const bytes = measureSpecBytes(spec);
  if (bytes === null || bytes > GOVERNED_VEGA_LIMITS.maxSpecBytes) {
    errors.push(
      limitError({
        limit: "maxSpecBytes",
        path: JSON_POINTER_ROOT,
        actual: bytes ?? Number.POSITIVE_INFINITY,
        noun: "bytes",
      }),
    );
    return errors;
  }

  const depth = measureJsonDepth(spec, GOVERNED_VEGA_LIMITS.maxNestingDepth);
  if (depth > GOVERNED_VEGA_LIMITS.maxNestingDepth) {
    errors.push(
      limitError({
        limit: "maxNestingDepth",
        path: JSON_POINTER_ROOT,
        actual: depth,
        noun: "levels of nesting",
      }),
    );
  }

  return errors;
}

/** Row counts, checked before anything reads the specification at all. */
export function checkDatasetRowLimits(
  rowCountsByDataset: DatasetRowCounts,
): VegaValidationError[] {
  const errors: VegaValidationError[] = [];
  let total = 0;

  for (const [name, rows] of Object.entries(rowCountsByDataset)) {
    total += rows;
    if (rows > GOVERNED_VEGA_LIMITS.maxRowsPerDataset) {
      errors.push(
        limitError({
          limit: "maxRowsPerDataset",
          path: JSON_POINTER_ROOT,
          actual: rows,
          noun: `rows in "${name}"`,
        }),
      );
    }
  }

  if (total > GOVERNED_VEGA_LIMITS.maxRowsAllDatasets) {
    errors.push(
      limitError({
        limit: "maxRowsAllDatasets",
        path: JSON_POINTER_ROOT,
        actual: total,
        noun: "rows across every dataset",
      }),
    );
  }

  return errors;
}

export interface GovernedVegaPolicyOutcome {
  readonly errors: readonly VegaValidationError[];
  readonly warnings: readonly VegaValidationWarning[];
}

/**
 * The policy walk over a schema-valid specification. Collects every refusal
 * rather than stopping at the first, so one pass tells the member everything
 * they have to change; the envelope limits already bound how much work that is.
 */
export function applyGovernedVegaPolicy({
  spec,
  registeredDatasets,
}: {
  spec: unknown;
  registeredDatasets: readonly string[];
}): GovernedVegaPolicyOutcome {
  const objects = visitJsonObjects(spec);
  const errors: VegaValidationError[] = [
    ...refuseCallerDatasets(spec),
    ...refuseUrlProperties(objects),
    ...refuseEmbedOptions(objects),
    ...refuseStringResourceProperties(objects),
    ...refuseImageMarks(objects),
    ...refuseUnregisteredData({ objects, registeredDatasets }),
    ...refuseUnresolvedViews(spec),
    ...checkCompositionLimits({ spec, objects }),
    ...checkTransforms(objects),
    ...checkExpressions(objects),
    ...checkInteractiveParams(objects),
  ];

  return { errors, warnings: [] };
}

function refuseCallerDatasets(spec: unknown): VegaValidationError[] {
  if (!isPlainObject(spec) || !("datasets" in spec)) return [];
  return [
    governedVegaError({
      rule: "data.caller-datasets",
      path: joinPointer(JSON_POINTER_ROOT, "datasets"),
      message:
        'A chart specification may not define its own datasets. Reference a registered dataset with {"data": {"name": "…"}} instead.',
    }),
  ];
}

/**
 * Any property named `url`, anywhere. The Vega-Lite v6 schema puts one on
 * `UrlData`, on the `url` encoding channel, on `MarkDef`, and on six different
 * mark config definitions, so position-by-position rules would leak; the blanket
 * rule cannot, and no governed chart has a legitimate URL in it.
 */
function refuseUrlProperties(
  objects: readonly JsonObjectNode[],
): VegaValidationError[] {
  return objects
    .filter(({ node }) => "url" in node)
    .map(({ path }) => {
      const urlPath = joinPointer(path, "url");
      return governedVegaError({
        rule: urlRuleFor(path),
        path: urlPath,
        message: `Loading a resource from a URL is not permitted (at ${urlPath}). Charts read only the datasets registered for this result.`,
      });
    });
}

function urlRuleFor(parentPath: string): GovernedVegaRuleId {
  if (parentPath.endsWith("/from/data")) return "lookup.url-data";
  if (parentPath.endsWith("/data")) return "data.url";
  if (parentPath.endsWith("/encoding")) return "encoding.url";
  return "resource.url-property";
}

function refuseEmbedOptions(
  objects: readonly JsonObjectNode[],
): VegaValidationError[] {
  return objects
    .filter(
      ({ parentKey, node }) =>
        parentKey === "usermeta" && "embedOptions" in node,
    )
    .map(({ path }) =>
      governedVegaError({
        rule: "runtime.embed-options",
        path: joinPointer(path, "embedOptions"),
        message:
          "A chart specification may not set the chart runtime's own options. Remove usermeta.embedOptions.",
      }),
    );
}

/**
 * `config` and `patch` given as strings are how vega-embed is told to fetch a
 * remote configuration or JSON patch. Neither is ever a string in a governed spec.
 */
function refuseStringResourceProperties(
  objects: readonly JsonObjectNode[],
): VegaValidationError[] {
  const errors: VegaValidationError[] = [];
  for (const { path, node } of objects) {
    for (const key of ["config", "patch"]) {
      if (typeof node[key] !== "string") continue;
      errors.push(
        governedVegaError({
          rule: "resource.url-property",
          path: joinPointer(path, key),
          message: `"${key}" must not be a string: a string is read as a URL to fetch. Inline the value or remove it.`,
        }),
      );
    }
  }
  return errors;
}

function refuseImageMarks(
  objects: readonly JsonObjectNode[],
): VegaValidationError[] {
  return objects
    .filter(({ node }) => isImageMark(node.mark))
    .map(({ path }) =>
      governedVegaError({
        rule: "mark.image",
        path: joinPointer(path, "mark"),
        message:
          "Image marks load remote resources and are not permitted. Use a mark that draws from the dataset instead.",
      }),
    );
}

function isImageMark(mark: unknown): boolean {
  if (mark === "image") return true;
  return isPlainObject(mark) && mark.type === "image";
}

/** Data objects: the view's own `data`, and a lookup's `from.data`. */
function dataObjectsOf(
  objects: readonly JsonObjectNode[],
): { path: string; node: Record<string, unknown>; isLookup: boolean }[] {
  return objects
    .filter(({ parentKey }) => parentKey === "data")
    .map(({ path, node }) => ({
      path,
      node,
      isLookup: path.endsWith("/from/data"),
    }));
}

function refuseUnregisteredData({
  objects,
  registeredDatasets,
}: {
  objects: readonly JsonObjectNode[];
  registeredDatasets: readonly string[];
}): VegaValidationError[] {
  const errors: VegaValidationError[] = [];
  for (const { path, node, isLookup } of dataObjectsOf(objects)) {
    if ("values" in node) {
      errors.push(inlineValuesError({ path, isLookup }));
      continue;
    }
    if ("url" in node) continue; // already refused by the blanket URL rule
    errors.push(...checkDatasetName({ path, node, registeredDatasets }));
  }
  return errors;
}

function inlineValuesError({
  path,
  isLookup,
}: {
  path: string;
  isLookup: boolean;
}): VegaValidationError {
  return governedVegaError({
    rule: isLookup ? "lookup.inline-data" : "data.inline-values",
    path: joinPointer(path, "values"),
    message:
      "Inline data values are not accepted. Reference a registered dataset by name so the chart reads only what the query returned.",
  });
}

function checkDatasetName({
  path,
  node,
  registeredDatasets,
}: {
  path: string;
  node: Record<string, unknown>;
  registeredDatasets: readonly string[];
}): VegaValidationError[] {
  const name = node.name;
  if (typeof name === "string" && registeredDatasets.includes(name)) return [];

  const known = registeredDatasets.join(", ") || "none";
  const named = typeof name === "string" ? `"${name}"` : "no dataset name";
  return [
    governedVegaError({
      rule: "data.unknown-name",
      path,
      message: `This data source resolves to ${named}, which is not a registered dataset. Registered datasets: ${known}.`,
      meta: {
        requested: typeof name === "string" ? name : null,
        registeredDatasets,
      },
    }),
  ];
}

function refuseUnresolvedViews(spec: unknown): VegaValidationError[] {
  return collectViewNodes(spec)
    .filter((view) => view.isUnit && view.dataPath === null)
    .map((view) =>
      governedVegaError({
        rule: "data.unresolved",
        path: view.path,
        message:
          'This view has no data source. Add {"data": {"name": "…"}} to it or to a spec that contains it.',
      }),
    );
}

function checkCompositionLimits({
  spec,
  objects,
}: {
  spec: unknown;
  objects: readonly JsonObjectNode[];
}): VegaValidationError[] {
  const errors: VegaValidationError[] = [];

  const unitViews = countUnitViews(spec);
  if (unitViews > GOVERNED_VEGA_LIMITS.maxUnitViews) {
    errors.push(
      limitError({
        limit: "maxUnitViews",
        path: JSON_POINTER_ROOT,
        actual: unitViews,
        noun: "views",
      }),
    );
  }

  for (const { path, node } of objects) {
    const layers = node.layer;
    if (
      !Array.isArray(layers) ||
      layers.length <= GOVERNED_VEGA_LIMITS.maxLayersPerView
    ) {
      continue;
    }
    errors.push(
      limitError({
        limit: "maxLayersPerView",
        path: joinPointer(path, "layer"),
        actual: layers.length,
        noun: "layers in one view",
      }),
    );
  }

  return errors;
}

/** Every transform step in the document, with the pointer that reaches it. */
function transformStepsOf(
  objects: readonly JsonObjectNode[],
): { path: string; step: Record<string, unknown> }[] {
  const steps: { path: string; step: Record<string, unknown> }[] = [];
  for (const { path, node } of objects) {
    const list = node.transform;
    if (!Array.isArray(list)) continue;
    const listPath = joinPointer(path, "transform");
    list.forEach((step, index) => {
      if (isPlainObject(step))
        steps.push({ path: joinPointer(listPath, index), step });
    });
  }
  return steps;
}

function checkTransforms(
  objects: readonly JsonObjectNode[],
): VegaValidationError[] {
  const steps = transformStepsOf(objects);
  const errors: VegaValidationError[] = [];

  if (steps.length > GOVERNED_VEGA_LIMITS.maxTransforms) {
    errors.push(
      limitError({
        limit: "maxTransforms",
        path: JSON_POINTER_ROOT,
        actual: steps.length,
        noun: "transform steps",
      }),
    );
  }

  for (const { path, step } of steps) {
    if (identifyTransform(step) !== null) continue;
    errors.push(
      governedVegaError({
        rule: "transform.unknown",
        path,
        message: `This transform is outside the reviewed set. Permitted transforms: ${ALLOWED_VEGA_LITE_TRANSFORMS.join(", ")}.`,
        meta: { allowed: ALLOWED_VEGA_LITE_TRANSFORMS },
      }),
    );
  }

  return errors;
}

/**
 * The allowlisted transform a step declares, or `null` when it declares none or
 * more than one — a step carrying two signature keys is refused rather than
 * guessed at.
 */
export function identifyTransform(
  step: Record<string, unknown>,
): string | null {
  const matched = Object.keys(step).filter((key) =>
    ALLOWED_TRANSFORM_SET.has(key),
  );
  return matched.length === 1 ? (matched[0] ?? null) : null;
}

/** Expression strings, including those nested in `and`/`or`/`not` predicates. */
function expressionStringsOf(
  objects: readonly JsonObjectNode[],
): { path: string; expression: string }[] {
  const found: { path: string; expression: string }[] = [];
  for (const { path, node } of objects) {
    for (const key of EXPRESSION_BEARING_KEYS) {
      if (!(key in node)) continue;
      collectPredicateStrings({
        value: node[key],
        path: joinPointer(path, key),
        found,
      });
    }
  }
  return found;
}

function collectPredicateStrings({
  value,
  path,
  found,
}: {
  value: unknown;
  path: string;
  found: { path: string; expression: string }[];
}): void {
  if (typeof value === "string") {
    found.push({ path, expression: value });
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of ["and", "or", "not"]) {
    const branch = value[key];
    if (Array.isArray(branch)) {
      branch.forEach((item, index) =>
        collectPredicateStrings({
          value: item,
          path: joinPointer(joinPointer(path, key), index),
          found,
        }),
      );
      continue;
    }
    if (branch !== undefined) {
      collectPredicateStrings({
        value: branch,
        path: joinPointer(path, key),
        found,
      });
    }
  }
}

function checkExpressions(
  objects: readonly JsonObjectNode[],
): VegaValidationError[] {
  const errors: VegaValidationError[] = [];
  let totalBytes = 0;

  for (const { path, expression } of expressionStringsOf(objects)) {
    const bytes = measureUtf8Bytes(expression);
    totalBytes += bytes;
    if (bytes > GOVERNED_VEGA_LIMITS.maxExpressionBytes) {
      errors.push(
        limitError({
          limit: "maxExpressionBytes",
          path,
          actual: bytes,
          noun: "bytes in one expression",
        }),
      );
      continue;
    }
    errors.push(...screenOneExpression({ path, expression }));
  }

  if (totalBytes > GOVERNED_VEGA_LIMITS.maxTotalExpressionBytes) {
    errors.push(
      limitError({
        limit: "maxTotalExpressionBytes",
        path: JSON_POINTER_ROOT,
        actual: totalBytes,
        noun: "bytes of expressions",
      }),
    );
  }

  return errors;
}

function screenOneExpression({
  path,
  expression,
}: {
  path: string;
  expression: string;
}): VegaValidationError[] {
  const { forbiddenIdentifiers, forbiddenConstructs } =
    screenVegaExpression(expression);
  const refused = [...forbiddenIdentifiers, ...forbiddenConstructs];
  if (refused.length === 0) return [];

  return [
    governedVegaError({
      rule: "expression.forbidden",
      path,
      message: `This expression uses ${refused.join(", ")}, which is outside the reviewed set. Rewrite it using the permitted functions, or ask for the list to be extended.`,
      meta: { forbiddenIdentifiers, forbiddenConstructs },
    }),
  ];
}

function checkInteractiveParams(
  objects: readonly JsonObjectNode[],
): VegaValidationError[] {
  const total = objects.reduce((sum, { node }) => {
    const params = node.params;
    return Array.isArray(params) ? sum + params.length : sum;
  }, 0);

  if (total <= GOVERNED_VEGA_LIMITS.maxInteractiveParams) return [];
  return [
    limitError({
      limit: "maxInteractiveParams",
      path: JSON_POINTER_ROOT,
      actual: total,
      noun: "interactive parameters",
    }),
  ];
}

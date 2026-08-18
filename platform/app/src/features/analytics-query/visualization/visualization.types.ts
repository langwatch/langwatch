/**
 * The contract between the LangWatchQL workbench and its Vega-Lite chart
 * layer: what a renderer is handed, and what validation hands back.
 *
 * This module imports nothing. Every other module under `visualization/`
 * depends on it, so keeping it import-free keeps the dependency graph acyclic
 * and keeps a server-side import of the validator from evaluating anything.
 */

/** One dataset the renderer registers with Vega by name. */
export type LangWatchQLDataset = readonly Record<string, unknown>[];

/** A column of a registered dataset, as the LangWatchQL response describes it. */
export interface LangWatchQLDatasetColumn {
  readonly name: string;
  /** The ClickHouse type string the backend returned, carried verbatim. */
  readonly type: string;
}

/**
 * The renderer contract. Data reaches Vega only through `datasets`, keyed by
 * the names a spec is allowed to reference; a spec that names anything else is
 * refused before Vega sees it.
 */
export interface LangWatchQLVegaLiteChartProps {
  spec: unknown;
  datasets: Readonly<Record<string, LangWatchQLDataset>>;
  columnsByDataset: Readonly<Record<string, readonly LangWatchQLDatasetColumn[]>>;
  ariaLabel?: string;
}

/**
 * Stable presentation keys. These are what the client presentation registry is
 * keyed by; the specific rule that fired travels alongside as `rule`.
 *
 * These are validation *results*, not `HandledError`s: nothing here is thrown
 * across a boundary, so nothing here needs a wire contract.
 */
export const VEGA_VALIDATION_ERROR_CODES = [
  /** The spec text did not parse as JSON at all. */
  "invalid-json",
  /** The parsed value is not a JSON object — a URL string, array, or scalar. */
  "spec-not-object",
  /** An explicit `$schema` that is not Vega-Lite v6. Never silently converted. */
  "unsupported-schema-version",
  /** The bundled official Vega-Lite v6 JSON Schema refused the spec. */
  "schema-failure",
  /** A schema-valid spec the LangWatchQL policy refuses. */
  "policy-rejection",
  /** A data reference that does not resolve to a registered dataset. */
  "unknown-dataset",
  /** A field reference absent from the dataset feeding its branch. */
  "unknown-field",
  /** A named complexity ceiling was exceeded. */
  "complexity-refusal",
  /** The repository-owned loader refused a resource load at runtime. */
  "loader-blocked",
  /** Vega failed to compile or run the spec. Raised by the chart layer. */
  "render-failure",
  /** The encoded values were all empty or missing. Raised by the chart layer. */
  "empty-encoding",
] as const;

export type VegaValidationErrorCode =
  (typeof VEGA_VALIDATION_ERROR_CODES)[number];

/**
 * Every LangWatchQL rule, by stable id. The catalogue in `vegaLitePolicy.ts` maps
 * each id to its presentation code and a one-line summary, and is keyed by this
 * union so a new rule cannot be added without a catalogue entry.
 */
export const LWQL_VEGA_RULE_IDS = [
  "spec.not-json",
  "spec.not-object",
  "spec.unsupported-schema-version",
  "spec.schema-invalid",
  "data.caller-datasets",
  "data.inline-values",
  "data.url",
  "data.unknown-name",
  "data.unresolved",
  "lookup.url-data",
  "lookup.inline-data",
  "mark.image",
  "encoding.url",
  "resource.url-property",
  "runtime.embed-options",
  "transform.unknown",
  "expression.forbidden",
  "field.unknown",
  "limit.maxSpecBytes",
  "limit.maxNestingDepth",
  "limit.maxUnitViews",
  "limit.maxLayersPerView",
  "limit.maxTransforms",
  "limit.maxExpressionBytes",
  "limit.maxTotalExpressionBytes",
  "limit.maxInteractiveParams",
  "limit.maxRowsPerDataset",
  "limit.maxRowsAllDatasets",
  "loader.blocked",
  "render.failure",
  "encoding.empty",
] as const;

export type LangWatchQLVegaRuleId = (typeof LWQL_VEGA_RULE_IDS)[number];

/**
 * A refusal. `path` is an RFC 6901 JSON Pointer into the caller's spec, using
 * `"/"` for the document root so it is never empty, and `message` names both
 * what was refused and what to change.
 */
export interface VegaValidationError {
  readonly code: VegaValidationErrorCode;
  readonly rule: LangWatchQLVegaRuleId;
  readonly path: string;
  readonly message: string;
  /** Structured detail a UI renders — limits, registered names, columns. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export const VEGA_VALIDATION_WARNING_CODES = [
  /**
   * A transform produces columns whose names are only knowable from the data
   * (`pivot`), so downstream field references cannot be checked statically.
   */
  "transform-fields-unverifiable",
  /**
   * An encoded value Vega cannot represent faithfully — NaN, an infinity, a
   * wide integer past float precision. Raised by the chart layer.
   */
  "unrepresentable-value",
] as const;

export type VegaValidationWarningCode =
  (typeof VEGA_VALIDATION_WARNING_CODES)[number];

export interface VegaValidationWarning {
  readonly code: VegaValidationWarningCode;
  readonly path: string;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Validation never rewrites the caller's spec: `normalized` is the very object
 * that was handed in, so "accepted" and "what Vega is given" cannot drift.
 */
export type VegaLiteValidationResult =
  | {
      readonly ok: true;
      readonly normalized: unknown;
      readonly warnings: readonly VegaValidationWarning[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly VegaValidationError[];
      readonly warnings: readonly VegaValidationWarning[];
    };

/** Row counts of the datasets a spec may reference, keyed by dataset name. */
export type DatasetRowCounts = Readonly<Record<string, number>>;

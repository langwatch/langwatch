/**
 * Trace origin classification (specs/traces/trace-type-classification.feature).
 * Absent/empty `langwatch.origin` is PENDING, not "application" — defaulting
 * it fired online evaluations on evaluation and simulation traces whenever a
 * child span arrived before the root span carrying the origin.
 *
 * Root/non-root origin ties break bytewise on the span id, never
 * `localeCompare` (which inverts base62 KSUIDs at the `Z`->`a` step).
 */

export const TRACE_ORIGINS = [
  "application",
  "evaluation",
  "simulation",
  "workflow",
  "playground",
] as const;
export type TraceOrigin = (typeof TRACE_ORIGINS)[number];

function isTraceOrigin(value: string): value is TraceOrigin {
  return (TRACE_ORIGINS as readonly string[]).includes(value);
}

/**
 * Bytewise comparison, never `localeCompare` (ADR-098 §5: ICU collation
 * inverts base62 KSUIDs at the `Z` → `a` step, so two workers would order the
 * same pair of span ids differently under locale rules).
 */
function isBytewiseSmaller(a: string, b: string): boolean {
  return a < b;
}

/** One span's origin-relevant signals, already extracted from its raw attributes. */
export interface SpanOriginSignals {
  readonly spanId: string;
  /** `true` for the span whose `parentSpanId` is null/absent. */
  readonly isRoot: boolean;
  /** The span's own `langwatch.origin` attribute value, if it set one. */
  readonly explicitOrigin?: string;
  /** `instrumentationScope.name`, for the legacy-inference ladder. */
  readonly instrumentationScopeName?: string;
  /** `metadata.platform`, pre-hoist. */
  readonly metadataPlatform?: string;
  /** `metadata.labels`, pre-hoist. */
  readonly metadataLabels?: readonly string[];
  /** Whether this span's resource attributes carry a `scenario.labels` key. */
  readonly hasScenarioLabelsResource?: boolean;
  /** Whether this span carries an `evaluation.run_id` attribute. */
  readonly hasEvaluationRunId?: boolean;
}

export interface OriginState {
  readonly rootOriginSpanId: string | null;
  readonly rootOrigin: string | null;
  readonly nonRootOriginSpanId: string | null;
  readonly nonRootOrigin: string | null;
  readonly hasEvaluationScope: boolean;
  readonly hasScenarioScope: boolean;
  readonly hasOptimizationStudioPlatform: boolean;
  readonly hasScenarioRunnerLabel: boolean;
  readonly hasScenarioLabelsResource: boolean;
  readonly hasEvaluationRunId: boolean;
  /** Preserved so a legitimate, non-legacy `metadata.platform` value survives stripping. */
  readonly lastMetadataPlatform: string | null;
}

export function initOriginState(): OriginState {
  return {
    rootOriginSpanId: null,
    rootOrigin: null,
    nonRootOriginSpanId: null,
    nonRootOrigin: null,
    hasEvaluationScope: false,
    hasScenarioScope: false,
    hasOptimizationStudioPlatform: false,
    hasScenarioRunnerLabel: false,
    hasScenarioLabelsResource: false,
    hasEvaluationRunId: false,
    lastMetadataPlatform: null,
  };
}

const EVALUATION_SCOPE_NAME = "langwatch-evaluation";
const SCENARIO_SCOPE_NAME = "@langwatch/scenario";
const OPTIMIZATION_STUDIO_PLATFORM = "optimization_studio";
const SCENARIO_RUNNER_LABEL = "scenario-runner";

/** Folds one span's signals into the accumulator. Order-invariant — see the module docblock. */
export function applyOriginSpan(
  state: OriginState,
  span: SpanOriginSignals,
): OriginState {
  let next = state;

  if (span.explicitOrigin !== undefined) {
    if (span.isRoot) {
      if (
        next.rootOriginSpanId === null ||
        isBytewiseSmaller(span.spanId, next.rootOriginSpanId)
      ) {
        next = { ...next, rootOriginSpanId: span.spanId, rootOrigin: span.explicitOrigin };
      }
    } else if (
      next.nonRootOriginSpanId === null ||
      isBytewiseSmaller(span.spanId, next.nonRootOriginSpanId)
    ) {
      next = { ...next, nonRootOriginSpanId: span.spanId, nonRootOrigin: span.explicitOrigin };
    }
  }

  if (span.instrumentationScopeName === EVALUATION_SCOPE_NAME) {
    next = { ...next, hasEvaluationScope: true };
  }
  if (span.instrumentationScopeName === SCENARIO_SCOPE_NAME) {
    next = { ...next, hasScenarioScope: true };
  }
  if (span.metadataPlatform === OPTIMIZATION_STUDIO_PLATFORM) {
    next = { ...next, hasOptimizationStudioPlatform: true };
  }
  if (span.metadataPlatform !== undefined) {
    next = { ...next, lastMetadataPlatform: span.metadataPlatform };
  }
  if (span.metadataLabels?.includes(SCENARIO_RUNNER_LABEL)) {
    next = { ...next, hasScenarioRunnerLabel: true };
  }
  if (span.hasScenarioLabelsResource) {
    next = { ...next, hasScenarioLabelsResource: true };
  }
  if (span.hasEvaluationRunId) {
    next = { ...next, hasEvaluationRunId: true };
  }

  return next;
}

/**
 * The explicit origin, root-wins-if-set (spec "Hoisting"). `null` when no
 * span set one at all.
 */
function explicitOrigin(state: OriginState): string | null {
  return state.rootOrigin ?? state.nonRootOrigin;
}

/**
 * The 7-tier legacy inference ladder (spec "Step 3"), only consulted when no
 * span set `langwatch.origin` explicitly. Priority order matches the spec
 * exactly; each tier is a boolean OR, so which span carried the signal never
 * matters, only whether one did.
 */
function inferOrigin(state: OriginState): TraceOrigin | null {
  if (state.hasEvaluationScope) return "evaluation";
  if (state.hasScenarioScope) return "simulation";
  if (state.hasOptimizationStudioPlatform) return "workflow";
  if (state.hasScenarioRunnerLabel) return "simulation";
  if (state.hasScenarioLabelsResource) return "simulation";
  if (state.hasEvaluationRunId) return "evaluation";
  return null;
}

/**
 * Resolves the trace's origin. `null` means PENDING — not yet determined,
 * never defaulted to "application" (spec preamble).
 */
export function resolveOrigin(state: OriginState): TraceOrigin | null {
  const explicit = explicitOrigin(state);
  if (explicit !== null) {
    // An unrecognised wire value is treated the same as "no explicit value" —
    // it falls through to inference rather than being surfaced as a made-up
    // origin, so a future SDK sending a new spelling degrades to PENDING/
    // inferred instead of polluting the closed enum trace-list filters read.
    if (isTraceOrigin(explicit)) return explicit;
    return inferOrigin(state);
  }
  return inferOrigin(state);
}

/**
 * Legacy-marker stripping (spec "Step 1d"): once a trace carries an explicit
 * origin, the platform-specific markers that origin superseded are dropped
 * from the summary's attributes so a new trace looks clean immediately.
 * Exact-match only, and only these two keys — generic keys like
 * `metadata.environment` are left untouched regardless of origin.
 */
export interface LegacyMarkerStripping {
  /** `true` when `langwatch.platform` should be omitted from summary attributes. */
  readonly stripPlatform: boolean;
  /** `true` when the single `"scenario-runner"` entry should be removed from `langwatch.labels`. */
  readonly stripScenarioRunnerLabel: boolean;
}

export function legacyMarkerStripping(state: OriginState): LegacyMarkerStripping {
  const hasExplicitOrigin = explicitOrigin(state) !== null;
  return {
    stripPlatform:
      hasExplicitOrigin && state.lastMetadataPlatform === OPTIMIZATION_STUDIO_PLATFORM,
    stripScenarioRunnerLabel: hasExplicitOrigin && state.hasScenarioRunnerLabel,
  };
}

/**
 * Removes the platform-specific legacy markers from an already-hoisted
 * attribute map, per {@link legacyMarkerStripping}. `attributes` and `labels`
 * are the summary's own hoisted views — `langwatch.platform` and
 * `langwatch.labels` — never the raw span attributes.
 */
const LANGWATCH_ORIGIN_ATTR = "langwatch.origin";
const METADATA_PLATFORM_ATTR = "metadata.platform";
const METADATA_LABELS_ATTR = "metadata.labels";
const SCENARIO_LABELS_RESOURCE_ATTR = "scenario.labels";
const EVALUATION_RUN_ID_ATTR = "evaluation.run_id";

/**
 * Adapts a `CanonicalSpan` (already flattened by `canonicalizeSpan.ts`) into
 * the signal shape `applyOriginSpan` folds. Kept here, next to the state and
 * transition it feeds, rather than in `spanDerivation.ts` — origin is the one
 * concern with a whole dedicated module, so its own extraction belongs beside
 * it.
 */
export function extractOriginSignals(span: {
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly instrumentationScopeName: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly resourceAttributes: Readonly<Record<string, unknown>>;
}): SpanOriginSignals {
  const explicitOrigin = span.attributes[LANGWATCH_ORIGIN_ATTR];
  const metadataPlatform = span.attributes[METADATA_PLATFORM_ATTR];
  const metadataLabelsRaw = span.attributes[METADATA_LABELS_ATTR];
  const metadataLabels = Array.isArray(metadataLabelsRaw)
    ? metadataLabelsRaw.filter((v): v is string => typeof v === "string")
    : undefined;

  return {
    spanId: span.spanId,
    isRoot: span.parentSpanId === null,
    explicitOrigin: typeof explicitOrigin === "string" ? explicitOrigin : undefined,
    instrumentationScopeName: span.instrumentationScopeName || undefined,
    metadataPlatform: typeof metadataPlatform === "string" ? metadataPlatform : undefined,
    metadataLabels,
    hasScenarioLabelsResource: SCENARIO_LABELS_RESOURCE_ATTR in span.resourceAttributes,
    hasEvaluationRunId: EVALUATION_RUN_ID_ATTR in span.attributes,
  };
}

export function stripLegacyOriginMarkers(args: {
  readonly state: OriginState;
  readonly platform: string | null;
  readonly labels: readonly string[];
}): { readonly platform: string | null; readonly labels: readonly string[] } {
  const stripping = legacyMarkerStripping(args.state);
  return {
    platform: stripping.stripPlatform ? null : args.platform,
    labels: stripping.stripScenarioRunnerLabel
      ? args.labels.filter((label) => label !== SCENARIO_RUNNER_LABEL)
      : args.labels,
  };
}

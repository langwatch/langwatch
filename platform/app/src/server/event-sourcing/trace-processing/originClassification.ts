/**
 * Trace origin classification (specs/traces/trace-type-classification.feature).
 * An absent or empty `langwatch.origin` is PENDING, never "application":
 * defaulting it fired online evaluations on evaluation and simulation traces
 * whenever a child span arrived before the root span carrying the origin.
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

/** Never `localeCompare`: ICU collation inverts base62 KSUIDs at `Z` → `a`. */
function isBytewiseSmaller(a: string, b: string): boolean {
  return a < b;
}

/** One span's origin-relevant signals, already extracted from its raw attributes. */
export interface SpanOriginSignals {
  readonly spanId: string;
  readonly isRoot: boolean;
  readonly explicitOrigin?: string;
  readonly instrumentationScopeName?: string;
  readonly metadataPlatform?: string;
  readonly metadataLabels?: readonly string[];
  readonly hasScenarioLabelsResource?: boolean;
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
  /**
   * Kept so a legitimate, non-legacy `metadata.platform` survives stripping.
   * Owned by the bytewise-smallest contributing span, the same rule the
   * attribute map uses, so stripping decides on the value a reader will see.
   */
  readonly metadataPlatform: string | null;
  readonly metadataPlatformSpanId: string | null;
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
    metadataPlatform: null,
    metadataPlatformSpanId: null,
  };
}

const EVALUATION_SCOPE_NAME = "langwatch-evaluation";
const SCENARIO_SCOPE_NAME = "@langwatch/scenario";
const OPTIMIZATION_STUDIO_PLATFORM = "optimization_studio";
const SCENARIO_RUNNER_LABEL = "scenario-runner";

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
        next = {
          ...next,
          rootOriginSpanId: span.spanId,
          rootOrigin: span.explicitOrigin,
        };
      }
    } else if (
      next.nonRootOriginSpanId === null ||
      isBytewiseSmaller(span.spanId, next.nonRootOriginSpanId)
    ) {
      next = {
        ...next,
        nonRootOriginSpanId: span.spanId,
        nonRootOrigin: span.explicitOrigin,
      };
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
  if (
    span.metadataPlatform !== undefined &&
    (next.metadataPlatformSpanId === null ||
      isBytewiseSmaller(span.spanId, next.metadataPlatformSpanId))
  ) {
    next = {
      ...next,
      metadataPlatform: span.metadataPlatform,
      metadataPlatformSpanId: span.spanId,
    };
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

/** The explicit origin, root-wins-if-set. `null` when no span set one. */
function explicitOrigin(state: OriginState): string | null {
  return state.rootOrigin ?? state.nonRootOrigin;
}

/**
 * The legacy inference ladder, consulted only when no span set
 * `langwatch.origin`. Each tier is a boolean OR, so which span carried the
 * signal never matters — only whether one did.
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
 * `null` means PENDING — not yet determined, never defaulted. An unrecognised
 * wire value falls through to inference rather than polluting the closed enum
 * the trace-list filters read.
 */
export function resolveOrigin(state: OriginState): TraceOrigin | null {
  const explicit = explicitOrigin(state);
  if (explicit !== null && isTraceOrigin(explicit)) return explicit;
  return inferOrigin(state);
}

/**
 * Once a trace carries an explicit origin, the platform markers that origin
 * superseded are dropped from the summary's attributes. Exact-match only:
 * generic keys like `metadata.environment` are left alone.
 */
export interface LegacyMarkerStripping {
  readonly stripPlatform: boolean;
  readonly stripScenarioRunnerLabel: boolean;
}

export function legacyMarkerStripping(
  state: OriginState,
): LegacyMarkerStripping {
  const hasExplicitOrigin = explicitOrigin(state) !== null;
  return {
    stripPlatform:
      hasExplicitOrigin &&
      state.metadataPlatform === OPTIMIZATION_STUDIO_PLATFORM,
    stripScenarioRunnerLabel: hasExplicitOrigin && state.hasScenarioRunnerLabel,
  };
}

const LANGWATCH_ORIGIN_ATTR = "langwatch.origin";
const METADATA_PLATFORM_ATTR = "metadata.platform";
const METADATA_LABELS_ATTR = "metadata.labels";
const SCENARIO_LABELS_RESOURCE_ATTR = "scenario.labels";
const EVALUATION_RUN_ID_ATTR = "evaluation.run_id";

export function extractOriginSignals(span: {
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly instrumentationScopeName: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly resourceAttributes: Readonly<Record<string, unknown>>;
}): SpanOriginSignals {
  const explicit = span.attributes[LANGWATCH_ORIGIN_ATTR];
  const platform = span.attributes[METADATA_PLATFORM_ATTR];
  const rawLabels = span.attributes[METADATA_LABELS_ATTR];

  return {
    spanId: span.spanId,
    isRoot: span.parentSpanId === null,
    explicitOrigin: typeof explicit === "string" ? explicit : undefined,
    instrumentationScopeName: span.instrumentationScopeName || undefined,
    metadataPlatform: typeof platform === "string" ? platform : undefined,
    metadataLabels: Array.isArray(rawLabels)
      ? rawLabels.filter((value): value is string => typeof value === "string")
      : undefined,
    hasScenarioLabelsResource:
      SCENARIO_LABELS_RESOURCE_ATTR in span.resourceAttributes,
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

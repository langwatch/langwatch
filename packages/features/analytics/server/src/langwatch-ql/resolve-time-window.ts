/**
 * LangWatchQL analytics SQL — what a surface may do with the reserved time-window names, and the two ways it may not.
 * @see ./errors.ts — the two refusals
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import {
  LangWatchQLGranularityRequiresTimeWindowError,
  LangWatchQLGranularityTooFineError,
  LangWatchQLReservedGranularityTypeError,
  LangWatchQLReservedParameterSuppliedError,
  LangWatchQLReservedParameterTypeError,
} from "./errors";
import {
  formatLangWatchQLDateTimeParameter,
  isLangWatchQLDateTimeParameterType,
  isLangWatchQLGranularityParameterType,
  isLangWatchQLSurfaceParameter,
  isLangWatchQLTimeWindowParameter,
  type LangWatchQLTimeWindow,
  type LangWatchQLTimeWindowParameter,
  LWQL_GRANULARITY_MAX_BUCKETS,
  LWQL_GRANULARITY_STEPS,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_GRANULARITY_PARAMETER,
  LWQL_PERIOD_START_PARAMETER,
} from "@langwatch/analytics-contract";
import type { LangWatchQLParameter } from "./validation/validate";

/** What a statement's reserved names mean for the request about to be made. */
export interface LangWatchQLTimeWindowResolution {
  /**
   * The values to run with: the caller's, plus the window this surface
   * injected. Absent when there are none, so an unparameterised query keeps the
   * request shape it had before this contract existed.
   */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /**
   * Whether the statement declares at least one reserved name — the fact a
   * dashboard card reads to decide whether to badge itself as not following the
   * period.
   */
  readonly followsTimeWindow: boolean;
  /**
   * Reserved names the statement declares that no surface value filled, sorted:
   * the window pair when no window was supplied, plus a declared granularity
   * until the granularity resolver binds a step for it.
   */
  readonly awaitingTimeWindow: readonly string[];
}

function valueFor(name: LangWatchQLTimeWindowParameter, timeWindow: LangWatchQLTimeWindow): string {
  return formatLangWatchQLDateTimeParameter(
    name === LWQL_PERIOD_START_PARAMETER ? timeWindow.start : timeWindow.end,
  );
}

function withInjected({
  parameters,
  injected,
}: {
  parameters: Readonly<Record<string, unknown>> | undefined;
  injected: Readonly<Record<string, string>>;
}): Readonly<Record<string, unknown>> | undefined {
  const merged = { ...parameters, ...injected };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Decides what the reserved names mean for one request, and refuses the two
 * ways they can be misused.
 */
export function resolveLangWatchQLTimeWindow({
  declared,
  parameters,
  timeWindow,
}: {
  /** Bound parameters the validated statement declares. */
  readonly declared: readonly LangWatchQLParameter[];
  /** Values the caller sent. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** The period the surface is showing, when it has one. */
  readonly timeWindow?: LangWatchQLTimeWindow;
}): LangWatchQLTimeWindowResolution {
  const reserved = declared.filter((parameter) => isLangWatchQLTimeWindowParameter(parameter.name));

  const mistyped = reserved
    .filter((parameter) => !isLangWatchQLDateTimeParameterType(parameter.type))
    .map((parameter) => parameter.name)
    .sort();
  if (mistyped.length > 0) {
    throw new LangWatchQLReservedParameterTypeError(mistyped);
  }

  const supplied = Object.keys(parameters ?? {})
    .filter(isLangWatchQLSurfaceParameter)
    .sort();
  if (supplied.length > 0) {
    throw new LangWatchQLReservedParameterSuppliedError(supplied);
  }

  // A declared granularity is reserved too, but never window-injected: its
  // value is bound by the granularity resolver at run. Listing it as awaiting
  // is what keeps it out of the caller-missing sweep — a refusal naming a
  // parameter the caller is forbidden to supply is a dead end.
  const awaitingGranularity = declared
    .filter((parameter) => parameter.name === LWQL_PERIOD_GRANULARITY_PARAMETER)
    .map((parameter) => parameter.name);

  const followsTimeWindow = reserved.length > 0;
  if (!timeWindow) {
    return {
      ...(parameters ? { parameters } : {}),
      followsTimeWindow,
      awaitingTimeWindow: [
        ...reserved.map((parameter) => parameter.name),
        ...awaitingGranularity,
      ].sort(),
    };
  }

  const injected = Object.fromEntries(
    reserved.map((parameter) => [
      parameter.name,
      valueFor(parameter.name as LangWatchQLTimeWindowParameter, timeWindow),
    ]),
  );
  const merged = withInjected({ parameters, injected });
  return {
    ...(merged ? { parameters: merged } : {}),
    followsTimeWindow,
    awaitingTimeWindow: [...awaitingGranularity].sort(),
  };
}

/**
 * How many buckets a window at a step produces, rounded up -- a partial
 * bucket at the window's end still renders as a datapoint.
 */
function bucketCount(windowSeconds: number, stepSeconds: number): number {
  return Math.ceil(windowSeconds / stepSeconds);
}

/**
 * Re-exported so every existing importer of the budget arithmetic keeps reaching the
 * ceiling from here. It is defined in `./timeWindow.ts` because the dashboard's coarsening
 * notice cites it in the browser, and this module is server-only.
 */
export { LWQL_GRANULARITY_MAX_BUCKETS };

/**
 * What an overflowing period does to the step that overflowed it.
 */
export type LangWatchQLBudgetOverflowMode = "refuse" | "coarsen";

/** What a statement's granularity declaration means for one request. */
export interface LangWatchQLGranularityResolution {
  /**
   * The step this run was bucketed at, present when the statement declares the
   * granularity parameter and the surface supplied a value. Absent otherwise --
   * an undeclared statement keeps whatever bucketing its SQL text hard-codes.
   */
  readonly granularitySeconds?: number;
  /** Whether the statement declares the granularity parameter at all. */
  readonly followsGranularity: boolean;
  /**
   * The step the caller asked for, present only when this run coarsened:
   * the dashboard names requested and effective side by side rather than
   * changing a shared control's meaning silently.
   */
  readonly coarsenedFromSeconds?: number;
}

/**
 * The finest offered step whose bucket count fits the ceiling, for the surfaces that coarsen instead of refusing.
 * Undefined when even the coarsest offered step overflows: the ceiling is a hard browser-safety cap, so a window
 * nothing fits must refuse rather than hand back an in-budget-looking answer carrying many times the budget.
 */
function finestFittingStep(windowSeconds: number): number | undefined {
  for (const step of LWQL_GRANULARITY_STEPS) {
    if (bucketCount(windowSeconds, step) <= LWQL_GRANULARITY_MAX_BUCKETS) {
      return step;
    }
  }
  return undefined;
}

/** Whether a step is one the surface offers. */
function isOfferedStep(stepSeconds: number): boolean {
  return (LWQL_GRANULARITY_STEPS as readonly number[]).includes(stepSeconds);
}

/**
 * The declaration- and value-level refusals, extracted from {@link
 * resolveLangWatchQLGranularity} so that function reads as the decision it
 * makes rather than the gauntlet it runs.
 */
function assertSurfaceStepIsClean({
  declaredName,
  declaredType,
  parameters,
  granularitySeconds,
}: {
  readonly declaredName: string;
  readonly declaredType: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly granularitySeconds?: number;
}): void {
  if (!isLangWatchQLGranularityParameterType(declaredType)) {
    throw new LangWatchQLReservedGranularityTypeError({
      mistyped: [declaredName],
    });
  }

  // Only this resolver's own reserved name: the window sweep owns the other
  // two, and refusing them here would answer a window question from the
  // granularity path. The name is a member of `LWQL_SURFACE_PARAMETERS` by
  // construction, so an `isLangWatchQLSurfaceParameter` check alongside would
  // be implied by this equality and could never disagree with it.
  const supplied = Object.keys(parameters ?? {}).filter(
    (name) => name === LWQL_PERIOD_GRANULARITY_PARAMETER,
  );
  if (supplied.length > 0) {
    throw new LangWatchQLReservedParameterSuppliedError(supplied);
  }

  if (granularitySeconds !== undefined && !isOfferedStep(granularitySeconds)) {
    // A zero, fractional or off-list step is a malformed surface value, not a
    // caller choice -- the input schemas refuse it first; this is the backstop.
    throw new LangWatchQLReservedGranularityTypeError({
      mistyped: [declaredName],
      fault: "step-value",
    });
  }
}

/**
 * The budget half: window seconds against the step at the ceiling. This is
 * where the two designed overflow outcomes diverge -- refuse for the surfaces
 * whose caller chose the step, coarsen for the dashboard whose caller did not.
 */
function resolveAgainstBudget({
  declaredName: _declaredName,
  granularitySeconds,
  timeWindow,
  onBudgetOverflow,
}: {
  readonly declaredName: string;
  readonly granularitySeconds: number;
  readonly timeWindow: LangWatchQLTimeWindow;
  readonly onBudgetOverflow: LangWatchQLBudgetOverflowMode;
}): LangWatchQLGranularityResolution {
  const windowSeconds = Math.max(
    0,
    Math.ceil((timeWindow.end.getTime() - timeWindow.start.getTime()) / 1000),
  );
  const requestedBuckets = bucketCount(windowSeconds, granularitySeconds);

  if (requestedBuckets <= LWQL_GRANULARITY_MAX_BUCKETS) {
    return { followsGranularity: true, granularitySeconds };
  }

  if (onBudgetOverflow === "refuse") {
    throw new LangWatchQLGranularityTooFineError({
      requestedGranularitySeconds: granularitySeconds,
      windowSeconds,
      maxBuckets: LWQL_GRANULARITY_MAX_BUCKETS,
    });
  }

  const effective = finestFittingStep(windowSeconds);
  if (effective === undefined) {
    // Even the one-hour floor overflows: refuse with the same arithmetic the
    // refuse path names, so the caller learns the window is what must narrow.
    throw new LangWatchQLGranularityTooFineError({
      requestedGranularitySeconds: granularitySeconds,
      windowSeconds,
      maxBuckets: LWQL_GRANULARITY_MAX_BUCKETS,
    });
  }
  return {
    followsGranularity: true,
    granularitySeconds: effective,
    // Strictly greater, not merely different: a step equal to or finer than
    // the requested one did not coarsen anything, and reporting it as a
    // coarsening would put a notice on a card whose answer never changed.
    // Reachable the moment a day-scale step joins the offered list, where the
    // fallback to the coarsest fitting step can land below the request.
    ...(effective > granularitySeconds ? { coarsenedFromSeconds: granularitySeconds } : {}),
  };
}

/**
 * The save-time half of the granularity contract, shared by every door that persists a statement: a
 * granularity declaration is only meaningful when both period bounds are declared too -- without them
 * the bucket budget the dashboard computes is uncomputable -- and only when declared as `UInt32`.
 */
export function assertLangWatchQLGranularityDeclaration(
  declared: readonly LangWatchQLParameter[],
): void {
  const declaredGranularity = declared.find(
    (parameter) => parameter.name === LWQL_PERIOD_GRANULARITY_PARAMETER,
  );
  if (!declaredGranularity) return;

  if (!isLangWatchQLGranularityParameterType(declaredGranularity.type)) {
    throw new LangWatchQLReservedGranularityTypeError({
      mistyped: [declaredGranularity.name],
    });
  }

  const periodNames = [LWQL_PERIOD_START_PARAMETER, LWQL_PERIOD_END_PARAMETER];
  const absent = periodNames.filter(
    (name) => !declared.some((parameter) => parameter.name === name),
  );
  const mistyped = periodNames.filter(
    (name) =>
      !absent.includes(name) &&
      !declared.some(
        (parameter) =>
          parameter.name === name && isLangWatchQLDateTimeParameterType(parameter.type),
      ),
  );
  if (absent.length > 0 || mistyped.length > 0) {
    throw new LangWatchQLGranularityRequiresTimeWindowError({
      absent,
      mistyped,
    });
  }
}

/**
 * Decides what the granularity declaration means for one request, and refuses the ways it can be misused -- the granularity counterpart of {@link resolveLangWatchQLTimeWindow}, kept separate because its failure
 * modes differ: where the window is injected only when declared and merely reported otherwise, a granularity declaration binds the run to a *budget*, and the budget's overflow has two designed outcomes.
 * Surfaces the caller owns -- the workbench, the REST route -- refuse with {@link LangWatchQLGranularityTooFineError}; the dashboard owns the range and auto-coarsens instead, naming what happened.
 */
export function resolveLangWatchQLGranularity({
  declared,
  parameters,
  granularitySeconds,
  timeWindow,
  onBudgetOverflow = "refuse",
}: {
  /** Bound parameters the validated statement declares. */
  readonly declared: readonly LangWatchQLParameter[];
  /** Values the caller sent -- checked so a reserved one cannot slip through. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /**
   * The step the surface chose, when the statement declares the parameter
   * and the surface offers a choice. A positive integer when present.
   */
  readonly granularitySeconds?: number;
  /** The period this run is windowed to; the budget is computed against it. */
  readonly timeWindow?: LangWatchQLTimeWindow;
  /** Refuse (caller-owned surfaces) or coarsen (the dashboard) on overflow. */
  readonly onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
}): LangWatchQLGranularityResolution {
  const declaredGranularity = declared.find(
    (parameter) => parameter.name === LWQL_PERIOD_GRANULARITY_PARAMETER,
  );

  if (!declaredGranularity) {
    return { followsGranularity: false };
  }

  assertSurfaceStepIsClean({
    declaredName: declaredGranularity.name,
    declaredType: declaredGranularity.type,
    parameters,
    granularitySeconds,
  });

  if (granularitySeconds === undefined) {
    // Declared but the surface offered no choice: the statement runs with
    // the bucketing its SQL text hard-codes. The same documented limitation
    // as the window contract's awaiting list -- the declaration records
    // intent, and proving the parameter actually drives the bucketing
    // expression is out of reach statically.
    return { followsGranularity: true };
  }

  if (!timeWindow) {
    // No window, no budget to check. The save-time rule requiring both
    // period parameters alongside granularity makes this unreachable for
    // saved charts; a workbench run supplies the page period
    // unconditionally.
    return { followsGranularity: true, granularitySeconds };
  }

  return resolveAgainstBudget({
    declaredName: declaredGranularity.name,
    granularitySeconds,
    timeWindow,
    onBudgetOverflow,
  });
}

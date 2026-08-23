/**
 * LangWatchQL analytics SQL — what a surface may do with the reserved time-window
 * names, and the two ways it may not.
 *
 * The vocabulary is `./timeWindow.ts`; this is the policy over it, kept apart
 * because the browser reads the vocabulary and must never load the policy's
 * handled errors. Three rules, all enforced here rather than at any endpoint,
 * so REST, tRPC and anything later cannot each get them slightly different:
 *
 *  1. **The names belong to the surface.** A request that carries one of them
 *     under `parameters` is refused. Otherwise a saved chart could pin its own
 *     window and silently ignore the dashboard it sits on.
 *  2. **A reserved name must be a date-time.** Caught while validating, so it is
 *     refused at *save* as well as at run — both go through the same validator.
 *  3. **Injection only where declared.** A statement that names neither is
 *     allowed and runs unchanged; it is reported as not following the period,
 *     not refused. An all-time total is a legitimate chart.
 *
 * Two platform mechanisms were considered for this instead of bound parameters
 * and rejected, recorded so the question is not reopened from scratch:
 * `additional_table_filters` is unusable because the settings profile pins
 * `readonly = 1 CONST`, which refuses per-query settings outright; a row policy
 * carrying a time predicate is mandatory by construction, and the window has to
 * be optional and self-declared per statement — a policy can express neither
 * that nor `followsTimeWindow`.
 *
 * @see ./errors.ts — the two refusals
 * @see specs/analytics/lwql-workbench.feature
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
} from "./timeWindow";
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
   * Reserved names the statement declares that no surface value filled,
   * sorted: the window pair when no window was supplied, plus a declared
   * granularity until the granularity resolver binds a step for it.
   *
   * It is not a refusal on its own: validating a statement for *saving* has
   * no window and must not be refused for it, because every name here is
   * supplied by whoever renders the chart — never by the caller, so none of
   * them may reach a caller-missing refusal at validation. Executing with
   * names still on this list is what cannot proceed.
   */
  readonly awaitingTimeWindow: readonly string[];
}

function valueFor(
  name: LangWatchQLTimeWindowParameter,
  timeWindow: LangWatchQLTimeWindow,
): string {
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
 *
 * @throws {LangWatchQLReservedParameterTypeError} when a reserved name is
 *   declared as anything but a ClickHouse date-time. Raised before the
 *   caller-supplied check so that an author gets the same answer about their
 *   statement whether or not the request also carried a value for it.
 * @throws {LangWatchQLReservedParameterSuppliedError} when the request carries a
 *   value for a reserved name. Refused whether or not the statement declares it:
 *   a caller sending one either way believes it is theirs to set, and it is not.
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
  const reserved = declared.filter((parameter) =>
    isLangWatchQLTimeWindowParameter(parameter.name),
  );

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
 * Re-exported so every existing importer of the budget arithmetic keeps
 * reaching the ceiling from here. It is defined in `./timeWindow.ts` because
 * the dashboard's coarsening notice cites it in the browser, and this module
 * is server-only.
 */
export { LWQL_GRANULARITY_MAX_BUCKETS };

/**
 * What an overflowing period does to the step that overflowed it.
 *
 * `"refuse"` for a surface whose caller picked the step for the question they
 * are asking; `"coarsen"` for one whose period moves independently of the step
 * — a dashboard widget, whose saved step meets whatever period the dashboard's
 * control is currently set to. Named rather than repeated inline because the
 * choice travels from a tRPC input schema down to {@link resolveAgainstBudget},
 * and a widened copy at any hop would let a door coarsen that meant to refuse.
 */
export type LangWatchQLBudgetOverflowMode = "refuse" | "coarsen";

/** What a statement's granularity declaration means for one request. */
export interface LangWatchQLGranularityResolution {
  /**
   * The step this run was bucketed at, present when the statement declares
   * the granularity parameter and the surface supplied a value. Absent
   * otherwise -- an undeclared statement keeps whatever bucketing its SQL
   * text hard-codes.
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
 * The finest offered step whose bucket count fits the ceiling, for the
 * surfaces that coarsen instead of refusing. Undefined when even the
 * coarsest offered step overflows: the ceiling is a hard browser-safety
 * cap, so a window nothing fits must refuse rather than hand back an
 * in-budget-looking answer carrying many times the budget.
 */
function finestFittingStep(windowSeconds: number): number | undefined {
  for (const step of LWQL_GRANULARITY_STEPS) {
    if (bucketCount(windowSeconds, step) <= LWQL_GRANULARITY_MAX_BUCKETS) {
      return step;
    }
  }
  return undefined;
}

/**
 * The declaration- and value-level refusals, extracted from
 * {@link resolveLangWatchQLGranularity} so that function reads as the
 * decision it makes rather than the gauntlet it runs.
 *
 * @throws {LangWatchQLReservedGranularityTypeError} when the parameter is
 *   declared as anything but `UInt32`, or when the surface's step is not a
 *   positive whole number of seconds.
 * @throws {LangWatchQLReservedParameterSuppliedError} when the request
 *   carries a value for the reserved name.
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
    throw new LangWatchQLReservedGranularityTypeError([declaredName]);
  }

  const supplied = Object.keys(parameters ?? {}).filter(
    (name) => name === LWQL_PERIOD_GRANULARITY_PARAMETER,
  );
  if (supplied.length > 0) {
    throw new LangWatchQLReservedParameterSuppliedError(supplied);
  }

  if (
    granularitySeconds !== undefined &&
    (!Number.isInteger(granularitySeconds) || granularitySeconds <= 0)
  ) {
    // A zero or fractional step is a malformed surface value, not a caller
    // choice -- the input schemas refuse it first; this is the backstop.
    throw new LangWatchQLReservedGranularityTypeError([declaredName]);
  }
}

/**
 * The budget half: window seconds against the step at the ceiling. This is
 * where the two designed overflow outcomes diverge -- refuse for the
 * surfaces whose caller chose the step, coarsen for the dashboard whose
 * caller did not.
 *
 * @throws {LangWatchQLGranularityTooFineError} on overflow when asked to
 *   refuse — and, when asked to coarsen, when even the coarsest offered step
 *   still overflows: the ceiling is a hard cap, not a preference coarsening
 *   may trade away.
 */
function resolveAgainstBudget({
  declaredName,
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
    ...(effective !== granularitySeconds
      ? { coarsenedFromSeconds: granularitySeconds }
      : {}),
  };
}

/**
 * The save-time half of the granularity contract, shared by every door that
 * persists a statement: a granularity declaration is only meaningful when
 * both period bounds are declared too -- without them the bucket budget the
 * dashboard computes is uncomputable -- and only when declared as `UInt32`.
 *
 * Called from the service's `validate`, so tRPC and REST saves refuse here,
 * before anything is written. The value-level rules (positive integer, bucket
 * budget) are {@link resolveLangWatchQLGranularity}'s, at run.
 *
 * @throws {LangWatchQLReservedGranularityTypeError} when the parameter is
 *   declared as anything but `UInt32`.
 * @throws {LangWatchQLGranularityRequiresTimeWindowError} when it is declared
 *   but either period bound is missing.
 */
export function assertLangWatchQLGranularityDeclaration(
  declared: readonly LangWatchQLParameter[],
): void {
  const declaredGranularity = declared.find(
    (parameter) => parameter.name === LWQL_PERIOD_GRANULARITY_PARAMETER,
  );
  if (!declaredGranularity) return;

  if (!isLangWatchQLGranularityParameterType(declaredGranularity.type)) {
    throw new LangWatchQLReservedGranularityTypeError([
      declaredGranularity.name,
    ]);
  }

  const periodNames = [LWQL_PERIOD_START_PARAMETER, LWQL_PERIOD_END_PARAMETER];
  const missing = periodNames.filter(
    (name) =>
      !declared.some((parameter) => {
        if (parameter.name !== name) return false;
        return isLangWatchQLDateTimeParameterType(parameter.type);
      }),
  );
  if (missing.length > 0) {
    throw new LangWatchQLGranularityRequiresTimeWindowError();
  }
}

/**
 * Decides what the granularity declaration means for one request, and
 * refuses the ways it can be misused -- the granularity counterpart of
 * {@link resolveLangWatchQLTimeWindow}, kept separate because its failure
 * modes differ: where the window is injected only when declared and merely
 * reported otherwise, a granularity declaration binds the run to a *budget*,
 * and the budget's overflow has two designed outcomes. Surfaces the caller
 * owns -- the workbench, the REST route -- refuse with
 * {@link LangWatchQLGranularityTooFineError}; the dashboard owns the range
 * and auto-coarsens instead, naming what happened.
 *
 * @throws {LangWatchQLReservedGranularityTypeError} when the parameter is
 *   declared as anything but `UInt32`. Raised before any value check so an
 *   author gets the same answer about their statement whether or not the
 *   request also carried a value for it.
 * @throws {LangWatchQLReservedParameterSuppliedError} when the request
 *   carries a value for it. Asserted here as well as in the window sweep so
 *   this function stays safe when called on its own.
 * @throws {LangWatchQLGranularityTooFineError} when the declared window at
 *   the supplied step exceeds {@link LWQL_GRANULARITY_MAX_BUCKETS} buckets
 *   and the surface asked to refuse rather than coarsen — or when it asked
 *   to coarsen and even the coarsest offered step still overflows.
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

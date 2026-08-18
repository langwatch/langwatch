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
  LangWatchQLReservedParameterSuppliedError,
  LangWatchQLReservedParameterTypeError,
} from "./errors";
import {
  formatLangWatchQLDateTimeParameter,
  isLangWatchQLDateTimeParameterType,
  isLangWatchQLTimeWindowParameter,
  type LangWatchQLTimeWindow,
  type LangWatchQLTimeWindowParameter,
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
   * Reserved names the statement declares that no window filled, sorted.
   *
   * Non-empty only when no window was supplied at all. It is not a refusal on
   * its own: validating a statement for *saving* has no window and must not be
   * refused for it, because the window is supplied by whoever renders the
   * chart. Executing with names still on this list is what cannot proceed.
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
    .filter(isLangWatchQLTimeWindowParameter)
    .sort();
  if (supplied.length > 0) {
    throw new LangWatchQLReservedParameterSuppliedError(supplied);
  }

  const followsTimeWindow = reserved.length > 0;
  if (!timeWindow) {
    return {
      ...(parameters ? { parameters } : {}),
      followsTimeWindow,
      awaitingTimeWindow: reserved.map((parameter) => parameter.name).sort(),
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
    awaitingTimeWindow: [],
  };
}

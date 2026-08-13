/**
 * What each coded refusal gives the workbench to work with.
 *
 * The words a member reads never come from here — they come from the
 * code-keyed presentation registry, exactly as `error-handling.md` requires.
 * What this reads off the payload is the *structure* the registry cannot
 * carry: which line the parser stopped on, which rules the policy named, which
 * parameters were left unset. Each one has a surface that consumes it (editor
 * markers, the refusal detail, the parameters editor), which is the bar `meta`
 * has to clear before anything reads it.
 *
 * Everything is parsed defensively: `meta` is server-shaped but it crosses a
 * wire, and a malformed payload must degrade to "no extra detail" rather than
 * crash the pane that was about to explain the failure.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { readHandledError } from "~/features/errors/logic/readHandledError";

/** The codes the workbench presents differently from one another. */
export const GOVERNED_SQL_UNPARSEABLE_CODE = "governed_sql_unparseable";
export const GOVERNED_SQL_NOT_PERMITTED_CODE = "governed_sql_not_permitted";
export const GOVERNED_SQL_PARAMETER_MISSING_CODE =
  "governed_sql_parameter_missing";
export const GOVERNED_SQL_RESERVED_PARAMETER_SUPPLIED_CODE =
  "governed_sql_reserved_parameter_supplied";
export const GOVERNED_SQL_UNAVAILABLE_CODE = "governed_sql_unavailable";
export const GOVERNED_SQL_NOT_ENABLED_CODE = "governed_sql_not_enabled";
export const GOVERNED_SQL_TIMEOUT_CODE = "query_timeout";

/** Where in the submitted statement a refusal points. */
export interface GovernedSqlSourcePosition {
  readonly line: number;
  readonly column: number;
}

/** One reason the backend gave, as the workbench reads it. */
export interface GovernedSqlViolationView {
  readonly code: string;
  readonly clause: string;
  /** The backend's own sentence naming what to change. */
  readonly message: string;
  readonly at?: GovernedSqlSourcePosition;
}

/** The structured half of a refusal. */
export interface GovernedSqlFailure {
  /** The handled code, or `undefined` when the failure was not a handled one. */
  readonly code: string | undefined;
  readonly violations: readonly GovernedSqlViolationView[];
  /**
   * The parameter names the refusal named — left unset, or set when they were
   * the surface's to set. Which of the two it is depends on {@link code}, so the
   * reader that renders them is what decides; this only lifts the list off the
   * payload.
   */
  readonly parameters: readonly string[];
}

const NO_FAILURE: GovernedSqlFailure = {
  code: undefined,
  violations: [],
  parameters: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positionOf(value: unknown): GovernedSqlSourcePosition | undefined {
  if (!isRecord(value)) return undefined;
  const { line, column } = value;
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  if (!Number.isFinite(line) || !Number.isFinite(column)) return undefined;
  return { line, column };
}

function violationOf(entry: unknown): GovernedSqlViolationView | undefined {
  if (!isRecord(entry)) return undefined;
  const { code, clause, message } = entry;
  if (typeof code !== "string" || typeof message !== "string") return undefined;

  const at = positionOf(entry.at);
  return {
    code,
    clause: typeof clause === "string" ? clause : "statement",
    message,
    ...(at ? { at } : {}),
  };
}

function violationsOf(value: unknown): readonly GovernedSqlViolationView[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(violationOf)
    .filter(
      (violation): violation is GovernedSqlViolationView =>
        violation !== undefined,
    );
}

function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Lifts the structured detail off whatever the mutation rejected with.
 *
 * An unhandled failure yields {@link NO_FAILURE}: no code, nothing to mark, no
 * parameters to name — which is correct, because an unhandled failure has
 * nothing structured to say and degrades to the generic state.
 */
export function readGovernedSqlFailure(error: unknown): GovernedSqlFailure {
  if (!error) return NO_FAILURE;
  const handled = readHandledError(error);
  if (!handled) return NO_FAILURE;

  return {
    code: handled.code,
    violations: violationsOf(handled.meta.violations),
    parameters: stringsOf(handled.meta.parameters),
  };
}

/** One squiggle in the editor. */
export interface GovernedSqlEditorMarker {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

/**
 * The positions the editor marks.
 *
 * Only violations the backend gave a position for. A refusal with no position
 * marks nothing — the result pane still renders the whole registry copy, so the
 * member is told what happened either way, just not *where*.
 */
export function governedSqlEditorMarkers(
  failure: GovernedSqlFailure,
): readonly GovernedSqlEditorMarker[] {
  return failure.violations
    .filter(
      (
        violation,
      ): violation is GovernedSqlViolationView & {
        at: GovernedSqlSourcePosition;
      } => violation.at !== undefined,
    )
    .map((violation) => ({
      line: violation.at.line,
      column: violation.at.column,
      message: violation.message,
    }));
}

/**
 * The payload the query endpoint sends when no governed identity is
 * provisioned, minted client-side so the *availability* answer — a boolean, not
 * a failure — renders the same words as the refusal would.
 *
 * Deliberately not a second copy of the words: the registry, keyed by
 * `governed_sql_unavailable`, is still the only place they are written. This
 * carries the code and the fault so the presentation layer can find them.
 */
export function governedSqlUnavailablePayload(): unknown {
  return {
    data: {
      error: {
        code: GOVERNED_SQL_UNAVAILABLE_CODE,
        httpStatus: 503,
        fault: "platform",
        meta: {},
      },
    },
  };
}

/**
 * The counterpart for a project whose feature switch is off — the same shape as
 * the refusal `GovernedSqlNotEnabledError` sends, so the page renders the copy
 * the registry keys to `governed_sql_not_enabled`.
 *
 * A distinct payload rather than a second use of the unavailable one, because
 * the two say different things to different people: a switch is the customer's
 * administrator's to flip, an unprovisioned deployment is ours.
 */
export function governedSqlNotEnabledPayload(): unknown {
  return {
    data: {
      error: {
        code: GOVERNED_SQL_NOT_ENABLED_CODE,
        httpStatus: 403,
        fault: "customer",
        meta: {},
      },
    },
  };
}

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
 * @see specs/analytics/lwql-workbench.feature
 */

import { readHandledError } from "~/features/errors/logic/readHandledError";

/** The codes the workbench presents differently from one another. */
export const LWQL_UNPARSEABLE_CODE = "lwql_unparseable";
export const LWQL_NOT_PERMITTED_CODE = "lwql_not_permitted";
export const LWQL_PARAMETER_MISSING_CODE = "lwql_parameter_missing";
export const LWQL_RESERVED_PARAMETER_SUPPLIED_CODE = "lwql_reserved_parameter_supplied";
export const LWQL_UNAVAILABLE_CODE = "lwql_unavailable";
export const LWQL_NOT_ENABLED_CODE = "lwql_not_enabled";
export const LWQL_TIMEOUT_CODE = "query_timeout";

/** Where in the submitted statement a refusal points. */
export interface LangWatchQLSourcePosition {
  readonly line: number;
  readonly column: number;
}

/** One reason the backend gave, as the workbench reads it. */
export interface LangWatchQLViolationView {
  readonly code: string;
  readonly clause: string;
  /** The backend's own sentence naming what to change. */
  readonly message: string;
  readonly at?: LangWatchQLSourcePosition;
}

/** The structured half of a refusal. */
export interface LangWatchQLFailure {
  /** The handled code, or `undefined` when the failure was not a handled one. */
  readonly code: string | undefined;
  readonly violations: readonly LangWatchQLViolationView[];
  /**
   * The parameter names the refusal named — left unset, or set when they were
   * the surface's to set. Which of the two it is depends on {@link code}, so the
   * reader that renders them is what decides; this only lifts the list off the
   * payload.
   */
  readonly parameters: readonly string[];
}

const NO_FAILURE: LangWatchQLFailure = {
  code: undefined,
  violations: [],
  parameters: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positionOf(value: unknown): LangWatchQLSourcePosition | undefined {
  if (!isRecord(value)) return undefined;
  const { line, column } = value;
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  if (!Number.isFinite(line) || !Number.isFinite(column)) return undefined;
  return { line, column };
}

function violationOf(entry: unknown): LangWatchQLViolationView | undefined {
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

function violationsOf(value: unknown): readonly LangWatchQLViolationView[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(violationOf)
    .filter(
      (violation): violation is LangWatchQLViolationView => violation !== undefined,
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
export function readLangWatchQLFailure(error: unknown): LangWatchQLFailure {
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
export interface LangWatchQLEditorMarker {
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
export function lwqlEditorMarkers(
  failure: LangWatchQLFailure,
): readonly LangWatchQLEditorMarker[] {
  return failure.violations
    .filter(
      (
        violation,
      ): violation is LangWatchQLViolationView & {
        at: LangWatchQLSourcePosition;
      } => violation.at !== undefined,
    )
    .map((violation) => ({
      line: violation.at.line,
      column: violation.at.column,
      message: violation.message,
    }));
}

/**
 * The payload the query endpoint sends when no LangWatchQL identity is
 * provisioned, minted client-side so the *availability* answer — a boolean, not
 * a failure — renders the same words as the refusal would.
 *
 * Deliberately not a second copy of the words: the registry, keyed by
 * `lwql_unavailable`, is still the only place they are written. This
 * carries the code and the fault so the presentation layer can find them.
 */
export function lwqlUnavailablePayload(): unknown {
  return {
    data: {
      error: {
        code: LWQL_UNAVAILABLE_CODE,
        httpStatus: 503,
        fault: "platform",
        meta: {},
      },
    },
  };
}

/**
 * The counterpart for a project whose feature switch is off — the same shape as
 * the refusal `LangWatchQLNotEnabledError` sends, so the page renders the copy
 * the registry keys to `lwql_not_enabled`.
 *
 * A distinct payload rather than a second use of the unavailable one, because
 * the two say different things to different people: a switch is the customer's
 * administrator's to flip, an unprovisioned deployment is ours.
 */
export function lwqlNotEnabledPayload(): unknown {
  return {
    data: {
      error: {
        code: LWQL_NOT_ENABLED_CODE,
        httpStatus: 403,
        fault: "customer",
        meta: {},
      },
    },
  };
}

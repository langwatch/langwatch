import type { SerializedHandledError } from "@langwatch/handled-error";
import {
  type ErrorExplanation,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/workflow-web/studio-host/errors";
import { UNNAMED_FAILURE } from "./execution/types";

/**
 * What a failed cell says, plus the engine's own words for whoever asks.
 *
 * `raw` is never the headline. It is the string the engine wrote
 * (`httpblock: Post "…": lookup api.example.com: no such host`) — available on
 * hover or in the expanded cell to the person debugging the target they built,
 * exactly as `ComparisonCell` shows evaluator detail behind a popover.
 */
export type CellFailure = ErrorExplanation & { raw?: string };

/**
 * Turns a cell's stored failure into the words a customer reads.
 *
 * One rule for both grids — the live workbench and the read-back batch view —
 * because they are the same cell at two moments, and they used to disagree:
 * live it showed registry copy for the code, and after a reload it printed the
 * engine's raw string, because only the string was persisted.
 *
 *   - a CODE presents from the registry, like every other error in the app;
 *   - the unnamed-failure marker (an unhandled throw, which has nothing safe to
 *     say) degrades to the generic unknown state, per ADR-045;
 *   - a raw string with no code is all a pre-#6xxx row has, and beats saying
 *     nothing.
 */
export function describeCellFailure({
  error,
  domainError,
}: {
  error?: string | null;
  domainError?: SerializedHandledError;
}): CellFailure | null {
  const trimmed = error?.trim();
  // The wire message for a handled failure IS its code (#5984), so the string
  // column holds the slug rather than prose — not something to show anyone.
  const raw =
    trimmed && trimmed !== UNNAMED_FAILURE && trimmed !== domainError?.code
      ? trimmed
      : undefined;

  if (domainError) return { ...explainSerializedError(domainError), raw };

  if (!trimmed) return null;

  if (!raw) return { ...UNKNOWN_ERROR_PRESENTATION };

  return { title: raw, description: "", isRegistered: false, raw };
}

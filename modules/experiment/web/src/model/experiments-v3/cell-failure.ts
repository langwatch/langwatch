import type { SerializedHandledError } from "@langwatch/handled-error";
import {
  type ErrorExplanation,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/handled-error/presentation";
import { UNNAMED_FAILURE } from "@langwatch/experiment-contract";

/**
 * What a failed cell says, plus the engine's own words for whoever asks.
 */
export type CellFailure = ErrorExplanation & { raw?: string };

/**
 * Turns a cell's stored failure into the words a customer reads.
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
    trimmed && trimmed !== UNNAMED_FAILURE && trimmed !== domainError?.code ? trimmed : undefined;

  if (domainError) return { ...explainSerializedError(domainError), raw };

  if (!trimmed) return null;

  if (!raw) return { ...UNKNOWN_ERROR_PRESENTATION };

  return { title: raw, description: "", isRegistered: false, raw };
}

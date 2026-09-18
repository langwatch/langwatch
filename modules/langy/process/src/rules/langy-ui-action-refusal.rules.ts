/**
 * A saved-state transform refuses by name: it throws an error carrying its own
 * stable `code`, which the channel reports as the handler's failure reason.
 */

/* Read structurally: the error type belongs to the page family, not here. */
export const tryReadTransformRefusalCode = (error: unknown): string | null => {
  if (!(error instanceof Error) || error.name !== "TransformError") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

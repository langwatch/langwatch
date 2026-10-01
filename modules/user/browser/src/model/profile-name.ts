/**
 * The one refusal a name has to pass, stated once so every caller shares it:
 * a script, a future caller, and the Save button all get the same answer.
 */

/** Trimmed name, or null when there is nothing worth sending. */
export function sanitizeProfileName(candidate: string): string | null {
  const trimmed = candidate.trim();
  return trimmed === "" ? null : trimmed;
}

/** Whether a typed name is both non-blank and different from what is saved. */
export function profileNameMaySave({ typed, saved }: { typed: string; saved: string }): boolean {
  const sanitized = sanitizeProfileName(typed);
  return sanitized !== null && sanitized !== saved.trim();
}

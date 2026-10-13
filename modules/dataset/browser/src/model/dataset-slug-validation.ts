/**
 * What the server said about a proposed dataset name. `null` means
 * nothing has been asked yet, distinct from "asked, no conflict" — the
 * slug line renders nothing in the first case, a slug in the second.
 */
export type SlugValidation = {
  slug: string;
  hasConflict: boolean;
  conflictsWith?: string;
} | null;

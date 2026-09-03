/**
 * What the server said about a proposed dataset name.
 *
 * `null` means nothing has been asked yet — an empty name, or the first
 * keystroke before the check has run. It is deliberately distinct from "asked,
 * and there is no conflict", because the slug line renders nothing at all in
 * the first case and a slug in the second.
 */
export type SlugValidation = {
  slug: string;
  hasConflict: boolean;
  conflictsWith?: string;
} | null;

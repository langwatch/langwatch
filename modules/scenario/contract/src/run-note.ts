/**
 * Run note: free text per batch, travels in run metadata outside langwatch namespace.
 */

import { z } from "zod";

/** How long a run note may be, once its surrounding spaces are removed. */
export const MAX_RUN_NOTE_LENGTH = 200;

/**
 * A run note as it arrives from a caller. Spaces around it are removed before
 * the length is checked, so trailing whitespace never costs a caller the
 * request.
 */
export const runNoteSchema = z.string().trim().max(MAX_RUN_NOTE_LENGTH).optional();

/**
 * The `note` entry for a queued run's metadata, or nothing at all.
 *
 * A run without a note, and a run whose note is only spaces, record the
 * metadata they always did rather than an empty string every reader would have
 * to filter out.
 */
export function withNote(note: string | undefined): { note: string } | Record<string, never> {
  const trimmed = note?.trim();
  return trimmed ? { note: trimmed } : {};
}

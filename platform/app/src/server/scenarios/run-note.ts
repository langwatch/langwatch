/**
 * The note a person leaves with a run.
 *
 * A note is one short line of free text, like a commit message or a hypothesis.
 * It belongs to one batch run, and every run in that batch carries the same
 * note. It travels as the top-level `note` key of the run metadata, outside the
 * reserved `langwatch` namespace, so a caller that can set run metadata can set
 * a note without holding any platform-only field.
 *
 * @see specs/suites/run-notes.feature
 * @see specs/suites/run-note-metadata-convention.feature
 */

import { z } from "zod";

/** How long a run note may be, once its surrounding spaces are removed. */
export const MAX_RUN_NOTE_LENGTH = 200;

/**
 * A run note as it arrives from a caller. Spaces around it are removed before
 * the length is checked, so trailing whitespace never costs a caller the
 * request.
 */
export const runNoteSchema = z
  .string()
  .trim()
  .max(MAX_RUN_NOTE_LENGTH)
  .optional();

/**
 * The `note` entry for a queued run's metadata, or nothing at all.
 *
 * A run without a note, and a run whose note is only spaces, record the
 * metadata they always did rather than an empty string every reader would have
 * to filter out.
 */
export function withNote(
  note: string | undefined,
): { note: string } | Record<string, never> {
  const trimmed = note?.trim();
  return trimmed ? { note: trimmed } : {};
}

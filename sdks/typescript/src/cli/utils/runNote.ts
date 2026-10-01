/**
 * The `--note` flag every run command reads: a short line — hypothesis,
 * commit message, what changed — shared by every run in the batch.
 * @see specs/suites/run-notes.feature
 */

import { commandValidationError, reportCommandError } from "./errorOutput";

/** How long a note may be, once its surrounding spaces are removed. */
export const MAX_RUN_NOTE_LENGTH = 200;

/** The help line both run commands publish for the flag. */
export const NOTE_FLAG_HELP = `Why this run is being started: its hypothesis or commit message. Up to ${MAX_RUN_NOTE_LENGTH} characters.`;

/**
 * The note a run records, or nothing. Spaces-only is no note -- an empty
 * string would store a value every reader must filter. Too long ends the
 * command before anything is scheduled, not after a batch already started.
 */
export const parseRunNoteFlag = ({ note }: { note: string | undefined }): string | undefined => {
  const trimmed = note?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_RUN_NOTE_LENGTH) {
    reportCommandError({
      error: commandValidationError(
        `The note is too long: ${trimmed.length} characters, and up to ${MAX_RUN_NOTE_LENGTH} are allowed.`,
      ),
    });
    process.exit(1);
  }
  return trimmed;
};

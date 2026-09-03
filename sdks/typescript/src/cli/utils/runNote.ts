/**
 * The `--note` flag every run command reads.
 *
 * A note is one short line saying why a batch was run: a hypothesis, a commit
 * message, what changed. It travels with the batch and every run in it carries
 * the same note.
 *
 * @see specs/suites/run-notes.feature
 */

import { commandValidationError, reportCommandError } from "./errorOutput";

/** How long a note may be, once its surrounding spaces are removed. */
export const MAX_RUN_NOTE_LENGTH = 200;

/** The help line both run commands publish for the flag. */
export const NOTE_FLAG_HELP = `Why this run is being started: its hypothesis or commit message. Up to ${MAX_RUN_NOTE_LENGTH} characters.`;

/**
 * The note a run records, or nothing.
 *
 * A note of only spaces is no note: sending an empty string would store a
 * value every reader then has to filter out. A note that is too long ends the
 * command before anything is scheduled, so the caller can shorten it and run
 * once, rather than finding the refusal after a batch already started.
 */
export const parseRunNoteFlag = ({
  note,
}: {
  note: string | undefined;
}): string | undefined => {
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

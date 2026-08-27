/**
 * The note of a run: one short line, like a commit message or a hypothesis.
 *
 * The field appears when its chip is chosen and can be removed again. A note
 * over the limit blocks the run before anything is sent.
 *
 * @see specs/suites/run-notes.feature
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, Input, Text } from "@chakra-ui/react";
import { MAX_RUN_NOTE_LENGTH } from "@langwatch/scenario-contract";
import { DIALOG_FIELD_STYLE, FieldLabel } from "../shared/DialogFields";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";

export function isNoteTooLong(note: string): boolean {
  return note.trim().length > MAX_RUN_NOTE_LENGTH;
}

export type RunNoteFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
};

export function RunNoteField({ value, onChange, onRemove }: RunNoteFieldProps) {
  const isTooLong = isNoteTooLong(value);

  return (
    <Box data-testid="run-note-field">
      <FieldLabel>
        Note for the run
        <RemoveBlockButton label="Remove the note" onClick={onRemove} />
      </FieldLabel>
      <Input
        {...DIALOG_FIELD_STYLE}
        autoFocus
        value={value}
        aria-label="Note for the run"
        aria-invalid={isTooLong || undefined}
        placeholder="What changed, or the hypothesis: new system prompt, cheaper model..."
        onChange={(event) => onChange(event.target.value)}
      />
      {isTooLong && (
        <Text marginTop={1} fontSize="11px" color="red.fg" data-testid="run-note-too-long">
          The note is too long: it can hold {MAX_RUN_NOTE_LENGTH} characters.
        </Text>
      )}
    </Box>
  );
}

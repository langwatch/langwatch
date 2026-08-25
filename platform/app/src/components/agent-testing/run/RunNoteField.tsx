/**
 * The note of a run: one short line, like a commit message or a hypothesis.
 *
 * The field appears when its chip is chosen and can be removed again. A note
 * over the limit blocks the run before anything is sent.
 *
 * @see specs/suites/run-notes.feature
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { MAX_RUN_NOTE_LENGTH } from "~/server/scenarios/run-note";

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
    <VStack align="stretch" gap={1} data-testid="run-note-field">
      <HStack gap={1}>
        <Text fontSize="xs" fontWeight="medium" color="fg.muted">
          Note for the run
        </Text>
        <Button
          size="2xs"
          variant="ghost"
          color="fg.muted"
          aria-label="Remove the note"
          onClick={onRemove}
        >
          <X size={12} />
        </Button>
      </HStack>
      <Input
        size="sm"
        autoFocus
        value={value}
        aria-label="Note for the run"
        aria-invalid={isTooLong || undefined}
        placeholder="What changed, or the hypothesis: new system prompt, cheaper model..."
        onChange={(event) => onChange(event.target.value)}
      />
      {isTooLong && (
        <Text fontSize="xs" color="fg.error" data-testid="run-note-too-long">
          The note is too long: it can hold {MAX_RUN_NOTE_LENGTH} characters.
        </Text>
      )}
    </VStack>
  );
}

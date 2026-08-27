/**
 * Asks for the name of a new test suite, and nothing else.
 *
 * @see specs/suites/suite-folders.feature
 */

import { Button, Input } from "@chakra-ui/react";
import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";

export type NewSuiteDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
};

export function NewSuiteDialog({
  open,
  onClose,
  onCreate,
}: NewSuiteDialogProps) {
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose()}
      placement="center"
    >
      <Dialog.Content bg="bg" maxWidth="420px">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            New test suite
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Input
            autoFocus
            size="sm"
            placeholder="e.g. Refunds"
            aria-label="Test suite name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            size="sm"
            disabled={!name.trim()}
            onClick={submit}
          >
            Create
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

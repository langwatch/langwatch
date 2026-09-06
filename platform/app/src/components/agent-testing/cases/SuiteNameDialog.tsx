/**
 * Asks for the name of a test suite, and nothing else.
 *
 * A suite is only a grouping: it carries no targets, no repeat count, no
 * simulation models and no evaluators, so naming it is the whole of editing
 * one. The same dialog creates one and renames one.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/suites/test-suites.feature
 */

import { Button, Input, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Dialog } from "~/components/ui/dialog";

/** What the dialog says when the name is empty. */
export const SUITE_NAME_REQUIRED = "A test suite needs a name.";

export type SuiteNameDialogProps = {
  open: boolean;
  /** The name to start from. Empty when a suite is being created. */
  initialName?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
};

export function SuiteNameDialog({
  open,
  initialName = "",
  onClose,
  onConfirm,
}: SuiteNameDialogProps) {
  const isEditing = initialName !== "";
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setProblem(null);
  }, [open, initialName]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem(SUITE_NAME_REQUIRED);
      return;
    }
    setProblem(null);
    onConfirm(trimmed);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose()}
      placement="center"
    >
      <Dialog.Content
        bg="bg"
        maxWidth="420px"
        data-testid="agent-testing-suite-name-dialog"
      >
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            {isEditing ? "Rename test suite" : "New test suite"}
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
          {problem && (
            <Text
              paddingTop={2}
              fontSize="12px"
              color="red.600"
              data-testid="suite-name-problem"
            >
              {problem}
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            size="sm"
            onClick={submit}
            data-testid="suite-name-confirm"
          >
            {isEditing ? "Save" : "Create"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

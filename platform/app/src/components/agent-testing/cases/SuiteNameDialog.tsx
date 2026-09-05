/**
 * Asks for the name of a new test suite, and nothing else.
 *
 * A new suite starts as a grouping with a name. What else it declares, its
 * fields and its evaluators, is the suite editor's to ask for once the suite
 * exists.
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
  onClose: () => void;
  onConfirm: (name: string) => void;
};

export function SuiteNameDialog({
  open,
  onClose,
  onConfirm,
}: SuiteNameDialogProps) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setProblem(null);
  }, [open]);

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
            Create
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

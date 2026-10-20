/**
 * Asks only for the name of a new test suite; what it declares next is the suite editor's job.
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/suites/test-suites.feature
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Input, Text } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";

/** What the dialog says when the name is empty. */
export const SUITE_NAME_REQUIRED = "A test suite needs a name.";

export type SuiteNameDialogProps = {
  open: boolean;
  /** True while the suite is being created, so a second submit cannot send it twice. */
  isCreating?: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
};

export function SuiteNameDialog({
  open,
  isCreating = false,
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
    if (isCreating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem(SUITE_NAME_REQUIRED);
      return;
    }
    setProblem(null);
    onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New test suite"
      size="sm"
      placement="center"
      onSubmit={submit}
      primaryAction={{
        label: "Create",
        type: "submit",
        loading: isCreating,
        "data-testid": "suite-name-confirm",
      }}
      data-testid="agent-testing-suite-name-dialog"
    >
      <Input
        size="sm"
        placeholder="e.g. Refunds"
        aria-label="Test suite name"
        data-testid="suite-name-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {problem && (
        <Text paddingTop={2} textStyle="caption" color="red.fg" data-testid="suite-name-problem">
          {problem}
        </Text>
      )}
    </Dialog>
  );
}

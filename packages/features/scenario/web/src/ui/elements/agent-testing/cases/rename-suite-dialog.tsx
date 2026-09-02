/**
 * The editor of a test suite. A suite holds a name and its cases; the agents
 * it runs against are chosen in the run dialog each run, so the name is what
 * there is to edit here.
 *
 * @see specs/suites/suite-folders.feature
 */

import { Button, Input } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Dialog } from "@langwatch/workflow-web/components/ui/dialog";
import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";

export type RenameSuiteDialogProps = {
  suite: TestSuiteEntry | null;
  isLoading: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
};

export function RenameSuiteDialog({
  suite,
  isLoading,
  onClose,
  onRename,
}: RenameSuiteDialogProps) {
  const [name, setName] = useState(suite?.name ?? "");

  // The dialog root stays mounted, so the field has to follow the suite the
  // menu opened. Without this a name typed for one suite is saved onto the
  // next suite the person edits.
  useEffect(() => {
    setName(suite?.name ?? "");
  }, [suite?.id, suite?.name]);

  return (
    <Dialog.Root
      open={!!suite}
      onOpenChange={({ open }) => !open && onClose()}
      placement="center"
    >
      <Dialog.Content bg="bg" maxWidth="420px">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Edit test suite
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Input
            autoFocus
            size="sm"
            aria-label="Test suite name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            size="sm"
            loading={isLoading}
            onClick={() => onRename(name.trim() || (suite?.name ?? ""))}
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

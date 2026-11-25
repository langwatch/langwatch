/**
 * The one dialog that names a new test suite, opened from the rail, the
 * day-zero empty state, or a project with no suite yet. Editing an existing
 * suite is the suite editor's job, which asks for more than a name.
 */

import { useCallback, useState } from "react";

import type { SuiteMutations } from "../../../../behavior/agent-testing/cases/use-test-cases-mutations.ts";

export type SuiteNameDialogModel = {
  isOpen: boolean;
  /** True while the suite is being created; the dialog stays open until it lands. */
  isCreating: boolean;
  openNew: () => void;
  close: () => void;
  confirm: (name: string) => void;
};

export function useSuiteNameDialog({
  suiteMutations,
}: {
  suiteMutations: SuiteMutations;
}): SuiteNameDialogModel {
  const [isOpen, setIsOpen] = useState(false);

  const close = useCallback(() => setIsOpen(false), []);

  const confirm = useCallback(
    (name: string) => {
      suiteMutations.createSuite({ name, onCreated: close });
    },
    [suiteMutations, close],
  );

  return {
    isOpen,
    isCreating: suiteMutations.isCreating,
    openNew: useCallback(() => setIsOpen(true), []),
    close,
    confirm,
  };
}

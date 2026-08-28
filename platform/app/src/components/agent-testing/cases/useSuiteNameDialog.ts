/**
 * The one dialog that names a test suite, opened from the rail, from the name
 * above the scenarios table and from the day-zero empty state.
 *
 * It is one dialog and not two because creating and renaming ask the same
 * question. Which of the two it is reads off the suite it was opened on.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { useCallback, useMemo, useState } from "react";
import type { TestSuiteEntry } from "./test-cases";
import type { SuiteMutations } from "./useTestCasesMutations";

export type SuiteNameDialogModel = {
  isOpen: boolean;
  /** The suite being renamed, or nothing while one is being created. */
  suite: TestSuiteEntry | null;
  openNew: () => void;
  openRename: (suiteId: string) => void;
  close: () => void;
  confirm: (name: string) => void;
};

export function useSuiteNameDialog({
  suites,
  suiteMutations,
}: {
  suites: TestSuiteEntry[];
  suiteMutations: SuiteMutations;
}): SuiteNameDialogModel {
  // `undefined` is closed, `null` is open on a new suite, an id is open on
  // that one. One piece of state, so the two cannot disagree.
  const [openOn, setOpenOn] = useState<string | null | undefined>(undefined);

  const suite = useMemo(
    () => suites.find((entry) => entry.id === openOn) ?? null,
    [suites, openOn],
  );

  const close = useCallback(() => setOpenOn(undefined), []);

  const confirm = useCallback(
    (name: string) => {
      if (suite) suiteMutations.renameSuite({ suiteId: suite.id, name });
      else suiteMutations.createSuite(name);
      close();
    },
    [suite, suiteMutations, close],
  );

  return {
    isOpen: openOn !== undefined,
    suite,
    openNew: useCallback(() => setOpenOn(null), []),
    openRename: useCallback((suiteId: string) => setOpenOn(suiteId), []),
    close,
    confirm,
  };
}

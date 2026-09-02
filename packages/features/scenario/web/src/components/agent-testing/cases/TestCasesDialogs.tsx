/**
 * The dialogs the Test cases tab keeps mounted: the run dialog, the archive
 * confirmation of a case, and the editor of a test suite.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { ScenarioArchiveDialog } from "../../../index";
import { RunDialog } from "../run/RunDialog";
import { RenameSuiteDialog } from "./RenameSuiteDialog";
import type { TestCasesTabModel } from "./useTestCasesTab";

export function TestCasesDialogs({ model }: { model: TestCasesTabModel }) {
  const { run, caseMutations, suiteMutations } = model;
  const { caseToArchive } = caseMutations;

  return (
    <>
      <RunDialog
        subject={run.runSubject}
        onClose={run.closeRunDialog}
        onRunStarted={run.onRunStarted}
        onCaseRunSettled={run.clearRunningCase}
      />

      <ScenarioArchiveDialog
        open={!!caseToArchive}
        onClose={() => caseMutations.setCaseToArchive(null)}
        onConfirm={caseMutations.archiveCase}
        scenarios={caseToArchive ? [caseToArchive] : []}
        isLoading={caseMutations.isArchiving}
      />

      <RenameSuiteDialog
        suite={suiteMutations.suiteToRename}
        isLoading={suiteMutations.isRenaming}
        onClose={() => suiteMutations.setSuiteToRename(null)}
        onRename={suiteMutations.renameSuite}
      />
    </>
  );
}

/**
 * The dialogs the Scenarios tab keeps mounted: the run dialog, the archive
 * confirmation of a case, and the one dialog that names a test suite.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { ScenarioArchiveDialog } from "~/components/scenarios/ScenarioArchiveDialog";
import { RunDialog } from "../run/RunDialog";
import { SuiteNameDialog } from "./SuiteNameDialog";
import type { TestCasesTabModel } from "./useTestCasesTab";

export function TestCasesDialogs({ model }: { model: TestCasesTabModel }) {
  const { run, caseMutations, suiteDialog } = model;
  const { caseToArchive } = caseMutations;

  return (
    <>
      <SuiteNameDialog
        open={suiteDialog.isOpen}
        initialName={suiteDialog.suite?.name ?? ""}
        onClose={suiteDialog.close}
        onConfirm={suiteDialog.confirm}
      />
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
    </>
  );
}

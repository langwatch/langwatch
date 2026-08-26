/**
 * The dialogs the Scenarios tab keeps mounted: the run dialog and the
 * archive confirmation of a case. The suite editor is a drawer, not a
 * dialog, so it lives in the drawer registry.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { ScenarioArchiveDialog } from "~/components/scenarios/ScenarioArchiveDialog";
import { RunDialog } from "../run/RunDialog";
import type { TestCasesTabModel } from "./useTestCasesTab";

export function TestCasesDialogs({ model }: { model: TestCasesTabModel }) {
  const { run, caseMutations } = model;
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
    </>
  );
}

/**
 * The dialogs the Scenarios tab keeps mounted: the run dialog, the archive confirmation of a scenario, and the one dialog that names a test suite.
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { ScenarioArchiveDialog } from "../../../elements/scenario-archive-dialog.tsx";
import { RunDialog } from "../run/run-dialog.tsx";
import type { TestCasesTabModel } from "./use-test-cases-tab.ts";
import { SuiteNameDialog } from "./suite-name-dialog.tsx";

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

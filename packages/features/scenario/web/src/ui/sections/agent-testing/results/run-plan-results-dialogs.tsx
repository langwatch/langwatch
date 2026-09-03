/**
 * The dialogs the results column can open: the CSV export, and the run dialog.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ScenarioRunExportDialog } from "@langwatch/suite-web";
import { RunDialog } from "../run/run-dialog";
import type { RunPlanResultsColumnState } from "./use-run-plan-results-column";

export function RunPlanResultsDialogs({
  exportRuns,
  runDialog,
  runCount,
}: {
  exportRuns: RunPlanResultsColumnState["exportRuns"];
  runDialog: RunPlanResultsColumnState["runDialog"];
  runCount: number;
}) {
  return (
    <>
      <ScenarioRunExportDialog
        isOpen={exportRuns.isDialogOpen}
        onClose={exportRuns.closeExportDialog}
        onExport={exportRuns.startExport}
        runCount={runCount}
        hasFiltersApplied={false}
      />

      {/* The dialog carries the whole target and parameter machinery, so it is
          only mounted once a person asks for a run. */}
      {runDialog.subject && (
        <RunDialog
          subject={runDialog.subject}
          onClose={runDialog.close}
          onRunStarted={runDialog.onRunStarted}
        />
      )}
    </>
  );
}

/**
 * The dialogs the results column can open: the CSV export, and the run dialog.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { ScenarioRunExportDialog } from "~/components/suites/ScenarioRunExportDialog";
import { RunDialog } from "../run/RunDialog";
import type { RunPlanResultsColumnState } from "./useRunPlanResultsColumn";

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

import { useEffect } from "react";
import { useLangyStore } from "@langwatch/langy-web";
import { narrateWorkbenchRun } from "../../model/experiments-v3/actions/narration";

/**
 * Tell the Langy panel what this page is doing, so its status line can say so.
 */
export function useReportPageActivityToLangy({
  isRunning,
  runTargetName,
  completed,
  total,
  actionActivity,
}: {
  isRunning: boolean;
  /** The column being run, named as the reader sees it in its header. */
  runTargetName?: string | null;
  completed: number;
  total: number;
  /** An action being applied right now, already in words. */
  actionActivity: string | null;
}) {
  const setPageActivity = useLangyStore((state) => state.setPageActivity);

  useEffect(() => {
    const activity = isRunning
      ? narrateWorkbenchRun({ targetName: runTargetName, completed, total })
      : actionActivity;
    setPageActivity(activity);
  }, [isRunning, runTargetName, completed, total, actionActivity, setPageActivity]);

  // Leaving the page ends anything it was reporting. Without this the panel
  // keeps naming a run on a workbench the reader has navigated away from,
  // which is the false-progress failure the line exists to prevent.
  useEffect(() => {
    return () => setPageActivity(null);
  }, [setPageActivity]);
}

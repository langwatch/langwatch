import { useEffect } from "react";
import { useLangyStore } from "@langwatch/langy-web";
import { narrateWorkbenchRun } from "../../model/experiments-v3/actions/narration";

/**
 * Tell the Langy panel what this page is doing, so its status line can say so.
 *
 * The line may only say things that are true when it says them. With no tool
 * running and no tokens arriving it has nothing specific left and falls back
 * to a verb that claims nothing ("Cooking…"). While Langy drives the workbench
 * that is the weakest truth in the room: the page is running a named column
 * and knows how many cells are back, and the agent waiting on it is blocked in
 * a status poll that describes its own bookkeeping rather than the reader's
 * work.
 *
 * One writer, one slot. An action being applied and a run in flight are both
 * this page talking, so they are decided here in one order rather than by two
 * callers racing to set and clear the same value: a run outranks an action,
 * because a run is the long one and the action that started it has finished by
 * the time its cells arrive.
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

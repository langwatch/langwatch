/**
 * A board the address names but the held list lacks may have been made elsewhere since the list
 * was read (Langy, the CLI, another tab): read the list once more before calling it unavailable.
 * @see modules/dashboard/specs/board-made-elsewhere.feature
 */

import { useEffect, useRef, useState } from "react";

/** True while the one re-read for this address is in flight, so the screen waits on it. */
export function useRereadMissingBoard({
  dashboardId,
  isMissing,
  reread,
}: {
  dashboardId: string | undefined;
  isMissing: boolean;
  reread: () => Promise<unknown>;
}): boolean {
  const [rereadFor, setRereadFor] = useState<string | undefined>(void 0);
  const latestReread = useRef(reread);
  useEffect(() => {
    latestReread.current = reread;
  });
  const isPending = isMissing && dashboardId !== void 0 && rereadFor !== dashboardId;
  // Leaving the address ends the visit, so a later visit to a board still missing re-reads again.
  useEffect(() => {
    if (rereadFor !== void 0 && (rereadFor !== dashboardId || !isMissing)) setRereadFor(void 0);
  }, [rereadFor, dashboardId, isMissing]);
  useEffect(() => {
    if (!isPending) return;
    let isCurrent = true;
    void latestReread.current().finally(() => {
      if (isCurrent) setRereadFor(dashboardId);
    });
    return () => {
      isCurrent = false;
    };
  }, [isPending, dashboardId]);
  return isPending;
}

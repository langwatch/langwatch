/**
 * Langy on a board: whether this member may ask it anything, the ask itself,
 * and which block was just added so Langy can offer to read it (AC16, AC17).
 */

import { useState } from "react";

import {
  type AnalyticsLangyAskRequest,
  useAnalyticsHost,
} from "../../../../model/analytics-host.ts";
import type { BoardBlock } from "../../model/board-blocks.ts";
import { LANGY_ASK_PERMISSION, LANGY_RELEASE_FLAG } from "../model/board-langy.ts";

/** Off until the flag answers on and the member may start a conversation. */
export function useLangyAsk() {
  const host = useAnalyticsHost();
  const enabled =
    host.featureFlag(LANGY_RELEASE_FLAG) === true && host.hasPermission(LANGY_ASK_PERMISSION);
  return { enabled, ask: (request: AnalyticsLangyAskRequest) => host.askLangy(request) };
}

/**
 * The newest block added while the board was open. The first settled read is
 * the baseline, so blocks already there never count; `settle` retires the offer.
 */
export function useJustAddedBlock({
  blocks,
  settled,
}: {
  blocks: readonly BoardBlock[];
  settled: boolean;
}) {
  const [seen, setSeen] = useState<ReadonlySet<string> | undefined>();
  // Adjusting state while rendering, React's pattern for "the first settled read".
  if (settled && !seen) setSeen(new Set(blocks.map(({ widgetId }) => widgetId)));
  const justAdded = seen ? blocks.filter(({ widgetId }) => !seen.has(widgetId)).at(-1) : void 0;
  return {
    justAdded,
    settle: () => setSeen(new Set(blocks.map(({ widgetId }) => widgetId))),
  };
}

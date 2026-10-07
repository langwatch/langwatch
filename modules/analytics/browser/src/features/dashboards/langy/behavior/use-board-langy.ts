/** Whether this member may ask Langy anything on a board, and the ask itself (AC16). */

import { useEffect } from "react";

import {
  type AnalyticsLangyAskRequest,
  useAnalyticsHost,
} from "../../../../model/analytics-host.ts";
import { boardDraftAbout, LANGY_ASK_PERMISSION, LANGY_RELEASE_FLAG } from "../model/board-langy.ts";

/** Off until the flag answers on and the member may start a conversation. */
export function useLangyAsk() {
  const host = useAnalyticsHost();
  const enabled =
    host.featureFlag(LANGY_RELEASE_FLAG) === true && host.hasPermission(LANGY_ASK_PERMISSION);
  return { enabled, ask: (request: AnalyticsLangyAskRequest) => host.askLangy(request) };
}

/**
 * Tells Langy this board, and the widget open in its editor, is on screen while it is
 * mounted, so a draft about it is kept and one about anything else is dropped once shown.
 */
export function useBoardOnScreen({ boardId, itemRef }: { boardId: string; itemRef?: string }) {
  const host = useAnalyticsHost();
  useEffect(() => {
    host.showLangy({
      ...boardDraftAbout({ id: boardId }),
      ...(itemRef === void 0 ? {} : { itemRef }),
    });
  }, [host, boardId, itemRef]);
  // Apart, so closing the editor tells Langy the board alone, never nothing in between.
  useEffect(() => () => host.showLangy(null), [host, boardId]);
}

/** Whether this member may ask Langy anything on a board, and the ask itself (AC16). */

import {
  type AnalyticsLangyAskRequest,
  useAnalyticsHost,
} from "../../../../model/analytics-host.ts";
import { LANGY_ASK_PERMISSION, LANGY_RELEASE_FLAG } from "../model/board-langy.ts";

/** Off until the flag answers on and the member may start a conversation. */
export function useLangyAsk() {
  const host = useAnalyticsHost();
  const enabled =
    host.featureFlag(LANGY_RELEASE_FLAG) === true && host.hasPermission(LANGY_ASK_PERMISSION);
  return { enabled, ask: (request: AnalyticsLangyAskRequest) => host.askLangy(request) };
}

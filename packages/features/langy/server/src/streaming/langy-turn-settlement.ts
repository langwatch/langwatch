import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy-contract";
import type { LangyStreamEntry } from "./langy-token-buffer";

/** Decides a safe synthetic terminal when the live stream missed one. */
export function decideSyntheticTerminal({
  status,
  lastError,
  heartbeatStale,
}: {
  status: string;
  lastError: string | null;
  heartbeatStale: boolean;
}): LangyStreamEntry | null {
  if (!heartbeatStale) {
    return null;
  }
  if (
    status === LANGY_CONVERSATION_STATUS.ACTIVE ||
    status === LANGY_CONVERSATION_STATUS.RUNNING
  ) {
    return null;
  }
  if (status === LANGY_CONVERSATION_STATUS.FAILED) {
    return { type: "error", error: lastError ?? "Turn failed" };
  }
  if (status === LANGY_CONVERSATION_STATUS.IDLE) {
    return { type: "end" };
  }
  return null;
}

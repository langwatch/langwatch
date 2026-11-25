/** Ops badge count; restored from legacy chrome, now in settings menu */

import { useNavigationHost } from "../model/navigation-host.ts";
import { navigationApi } from "./navigation-api.ts";

/**
 * The count to render, or `undefined` while there is nothing to say — no
 * access, or no answer yet. Zero is an answer and stays a number, so the
 * renderer rather than this hook decides that zero draws nothing.
 */
export function useOpsAttentionCount(): number | undefined {
  const { hasAccess } = useNavigationHost().opsAccess();
  const counts = navigationApi.ops.getBadgeCounts.useQuery(undefined, {
    enabled: hasAccess,
    // needs a read hint: ops work blocked or dead-lettered
  });

  if (!hasAccess || !counts.data) return void 0;

  return counts.data.blockedCount + counts.data.dlqCount;
}

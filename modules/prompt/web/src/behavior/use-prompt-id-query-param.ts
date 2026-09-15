/**
 * `?promptId=` — the address that opens one prompt in a new tab. A
 * family-local copy of `platform/app/src/hooks/usePromptIdQueryParam.ts`; the
 * host answers the address instead, and it is READ rather than mirrored into
 * state.
 */

import { useCallback } from "react";
import { usePromptHost } from "../model/prompt-host.ts";

export function usePromptIdQueryParam() {
  const host = usePromptHost();
  const selectedPromptId = host.route().query.promptId ?? null;

  const setSelectedPromptId = useCallback(
    (promptId: string | null) => {
      host.setQuery({ promptId: promptId ?? void 0 }, { replace: false });
    },
    [host],
  );

  const clearSelection = useCallback(() => setSelectedPromptId(null), [setSelectedPromptId]);

  return { selectedPromptId, setSelectedPromptId, clearSelection };
}

/**
 * `?promptId=` — the address that opens one prompt in a new tab.
 *
 * A family-local copy of `platform/app/src/hooks/usePromptIdQueryParam.ts`,
 * which had no other importer and reached the router directly. The host answers
 * the address instead, and it is READ rather than mirrored into state: the same
 * correction the data-governance and model-config families made to their own
 * scope filters.
 */

import { useCallback } from "react";
import { usePromptHost } from "../model/prompt-host";

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

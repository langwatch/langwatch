/**
 * Re-reading who is signed in, on demand — the session query is held forever
 * (`staleTime: Infinity`) since signing in and signing out both leave the page
 * for a new document. The one exception: a new avatar photo needs a re-fetch.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { UI_SESSION_QUERY_KEY } from "./ui-session-client";

/** Asks for the signed-in reader to be read again, and waits for the answer. */
export function useRefreshUiSession(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: UI_SESSION_QUERY_KEY }),
    [queryClient],
  );
}

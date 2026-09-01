/**
 * Re-reading who is signed in, on demand.
 *
 * The session is one React Query entry, fetched once per document and held
 * forever (`staleTime: Infinity`), which is right: it changes when the reader
 * signs in or out, and both of those reload the page. One surface changes it
 * without a reload — the avatar control writes a new photo and the header has
 * to stop showing the old one — so it asks for the entry to be re-fetched.
 *
 * It lives in the global behavior layer because a frontend feature may not
 * import React Query, and because the query key is this layer's to know.
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

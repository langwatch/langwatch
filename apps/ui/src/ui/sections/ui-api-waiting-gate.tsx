/**
 * The shell holds the reader here while nothing is answering on the API's
 * address, and hands them straight on once something does.
 * Spec: specs/ui/api-boot-wait.feature
 */

import { hashKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useUiApiWait, UI_API_HEALTH_PATH } from "../../behavior/ui-api-reachability";
import { UI_SESSION_QUERY_KEY, type UiSessionReading } from "../../behavior/ui-session-client";
import { UiApiWaitingScreen } from "./ui-api-waiting-screen";

/** The address the wait is on, said in full so a developer can paste it. */
function healthEndpoint(): string {
  try {
    return new URL(UI_API_HEALTH_PATH, window.location.origin).toString();
  } catch {
    return UI_API_HEALTH_PATH;
  }
}

export function UiApiWaitingGate({
  children,
  isDevelopment = import.meta.env.DEV,
}: {
  children: ReactNode;
  /** Stated so a test can render both faces of the same screen. */
  isDevelopment?: boolean;
}) {
  const queryClient = useQueryClient();

  // The session read the shell already owns, watched rather than run. A second
  // `useQuery` on the same key would carry its own `queryFn` and, mounting
  // later, would be the one the cache refetched with — this gate would then be
  // answering its own question.
  // Filtered to the session's own entry: the cache is the whole application's,
  // and waking this gate on every read anywhere would re-render the routed page
  // under it once per query event.
  const subscribe = useCallback(
    (listener: () => void) => {
      const hash = hashKey(UI_SESSION_QUERY_KEY);
      return queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === hash) listener();
      });
    },
    [queryClient],
  );
  const readReading = useCallback(
    () => queryClient.getQueryData<UiSessionReading>(UI_SESSION_QUERY_KEY),
    [queryClient],
  );
  const reading = useSyncExternalStore(subscribe, readReading, readReading);

  const waiting = reading?.unreachable === true;
  const { answers, explaining } = useUiApiWait({ waiting });

  // The API answered, so the read that failed is asked again — the reader
  // continues to wherever they were going, and the document never reloads.
  useEffect(() => {
    if (answers === 0) return;
    void queryClient.invalidateQueries({ queryKey: UI_SESSION_QUERY_KEY });
  }, [answers, queryClient]);

  if (!waiting) return <>{children}</>;
  return (
    <UiApiWaitingScreen
      endpoint={healthEndpoint()}
      isDevelopment={isDevelopment}
      explaining={explaining}
    />
  );
}

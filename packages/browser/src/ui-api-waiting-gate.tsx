/**
 * The shell holds the reader here while nothing is answering on the API's
 * address, and hands them straight on once something does.
 * Spec: specs/ui/api-boot-wait.feature
 */

import { useUiApiWait, UI_API_HEALTH_PATH } from "@langwatch/browser-host/navigation";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

import { UiApiWaitingScreen } from "./ui-api-waiting-screen.tsx";

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
  isDevelopment,
  sessionQueryKey,
}: {
  children: ReactNode;
  /** Stated so a test can render both faces of the same screen. */
  isDevelopment: boolean;
  /**
   * The query key the composing application's session read is cached
   * under — auth's to name (`UI_SESSION_QUERY_KEY`), supplied here as data
   * so this file names no module. See `UiFeatureShellInstall`.
   */
  sessionQueryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();

  // The session read the shell already owns, watched rather than run: a
  // second `useQuery` would mount its own `queryFn` and end up being the
  // one refetched, answering its own question. Filtered to the session's
  // own entry, or every cache read would re-render the routed page.
  const subscribe = useCallback(
    (listener: () => void) => {
      const hash = hashKey(sessionQueryKey);
      return queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === hash) listener();
      });
    },
    [queryClient, sessionQueryKey],
  );
  const readReading = useCallback(
    () => queryClient.getQueryData<Readonly<{ unreachable?: boolean }>>(sessionQueryKey),
    [queryClient, sessionQueryKey],
  );
  const reading = useSyncExternalStore(subscribe, readReading, readReading);

  const waiting = reading?.unreachable === true;
  const { answers, explaining } = useUiApiWait({ waiting });

  // The API answered, so the read that failed is asked again — the reader
  // continues to wherever they were going, and the document never reloads.
  useEffect(() => {
    if (answers === 0) return;
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
  }, [answers, queryClient, sessionQueryKey]);

  if (!waiting) return <>{children}</>;
  return (
    <UiApiWaitingScreen
      endpoint={healthEndpoint()}
      isDevelopment={isDevelopment}
      explaining={explaining}
    />
  );
}

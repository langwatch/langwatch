import { useCallback, useEffect, useMemo, useState } from "react";
import { SCENARIO_TAB_QUERY_PARAM } from "~/server/scenarios/browser-tab/scenario-tab-events";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Session key holding the scenario tab key for this tab only. Session storage
 * rather than local storage on purpose: the registration belongs to the tab the
 * SDK opened, not to every tab in the browser.
 */
const SESSION_KEY = "langwatch:scenario-tab-key";
const SESSION_TAB_ID_KEY = "langwatch:scenario-tab-id";

/** Opt-out, deliberately browser-wide and durable across reloads. */
const OPT_OUT_KEY = "langwatch:scenario-tab-follow-disabled";

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession({ key, value }: { key: string; value: string }): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode or a storage-less embed: the tab simply won't be reusable.
  }
}

function readOptOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === "true";
  } catch {
    return false;
  }
}

function randomTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ScenarioTabFollowState {
  /** Machine key this tab answers for, or null when it is not a reusable tab. */
  tabKey: string | null;
  /** Identifies this tab within the machine key, so siblings don't collide. */
  tabId: string | null;
  /** True once the user asked this browser to stop following. */
  isDisabled: boolean;
  stopFollowing: () => void;
  resumeFollowing: () => void;
}

/**
 * Makes the current simulations tab the one the SDK reuses.
 *
 * The SDK stamps `?scenarioTab=<key>` on the tab it opens; that key is lifted
 * into session storage and scrubbed from the address bar so a copied link never
 * carries another machine's key. Callers feed the returned ids into the
 * simulation SSE subscription, which is what actually registers the tab.
 */
export function useScenarioTabFollow(): ScenarioTabFollowState {
  const router = useRouter();
  const [tabKey, setTabKey] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [isDisabled, setIsDisabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsDisabled(readOptOut());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !router.isReady) return;

    const fromQuery = router.query[SCENARIO_TAB_QUERY_PARAM];
    const queryKey = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;

    if (queryKey) {
      writeSession({ key: SESSION_KEY, value: queryKey });

      // Drop the param so the visible URL stays shareable. Shallow: this is a
      // cosmetic rewrite, not a navigation.
      const { [SCENARIO_TAB_QUERY_PARAM]: _dropped, ...rest } = router.query;
      void router.replace({ pathname: router.pathname, query: rest }, void 0, {
        shallow: true,
      });
    }

    const resolvedKey = queryKey ?? readSession(SESSION_KEY);
    if (!resolvedKey) return;

    let resolvedTabId = readSession(SESSION_TAB_ID_KEY);
    if (!resolvedTabId) {
      resolvedTabId = randomTabId();
      writeSession({ key: SESSION_TAB_ID_KEY, value: resolvedTabId });
    }

    setTabKey(resolvedKey);
    setTabId(resolvedTabId);
  }, [router.isReady, router.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopFollowing = useCallback(() => {
    try {
      window.localStorage.setItem(OPT_OUT_KEY, "true");
    } catch {
      // Best effort: the in-memory flag below still takes this tab out.
    }
    setIsDisabled(true);
  }, []);

  const resumeFollowing = useCallback(() => {
    try {
      window.localStorage.removeItem(OPT_OUT_KEY);
    } catch {
      // Best effort.
    }
    setIsDisabled(false);
  }, []);

  return useMemo(
    () => ({
      tabKey: isDisabled ? null : tabKey,
      tabId: isDisabled ? null : tabId,
      isDisabled,
      stopFollowing,
      resumeFollowing,
    }),
    [isDisabled, resumeFollowing, stopFollowing, tabId, tabKey],
  );
}

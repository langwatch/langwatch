/**
 * Which kind of home the reader was last on, remembered for the `/` resolver.
 *
 * The scope resolution already leaves `"project"` behind when a page under a
 * project slug resolves. This is the other half: a page under `/me` leaves
 * `"personal"`, and the index resolver reads whichever came last to decide
 * where a reader with no explicit pin lands.
 *
 * It lives in the global behavior layer rather than in the frontend feature
 * that calls it because it is a browser-storage write, which `src/features/*`
 * may not make — and because the key, its JSON encoding and the custom
 * broadcast are the contract `ui-scope-storage` already states with the
 * application that still reads them.
 *
 * `platform/app` did this inside `MyLayout`, on every render of every `/me`
 * page. Landing policy is not a screen's business and did not travel with the
 * family, the same cut the gateway family made when it dropped the onboarding
 * redirects off `useOrganizationTeamProject`.
 */

import { useEffect } from "react";
import { broadcastUiScopeWrite, useUiScopeMemory, writeUiScopeSelection } from "./ui-scope-storage";

/**
 * Marks the personal workspace as the last home this reader opened.
 *
 * Guarded on what is already stored: each write broadcasts a storage event
 * that re-renders every mounted reader, and an unguarded one would re-fire on
 * every pass.
 */
export function useRememberPersonalHome(): void {
  const { lastVisitedHomeKind } = useUiScopeMemory();

  useEffect(() => {
    if (lastVisitedHomeKind === "personal") return;
    writeUiScopeSelection({
      writes: [{ key: "lastVisitedHomeKind", value: "personal" }],
      storage: window.localStorage,
      broadcast: broadcastUiScopeWrite,
    });
  }, [lastVisitedHomeKind]);
}

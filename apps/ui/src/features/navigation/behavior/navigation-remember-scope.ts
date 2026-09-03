/**
 * Writes a scope choice through the application's own storage seam.
 *
 * Broadcast on every write, because the application still serves most of the
 * product from the same origin and its mounted `useLocalStorage` readers see
 * a write only through that event.
 */

import type { NavigationScopeWrite } from "@langwatch/navigation-web/screens/landing";
import { broadcastUiScopeWrite, writeUiScopeSelection } from "../../../behavior/ui-scope-storage";

export function rememberNavigationScope(write: NavigationScopeWrite): void {
  writeUiScopeSelection({
    writes: [
      ...(write.organizationId !== void 0
        ? [{ key: "organizationId" as const, value: write.organizationId }]
        : []),
      ...(write.projectSlug !== void 0
        ? [{ key: "projectSlug" as const, value: write.projectSlug }]
        : []),
    ],
    storage: window.localStorage,
    broadcast: broadcastUiScopeWrite,
  });
}

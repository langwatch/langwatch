/** Stores scope choice and broadcasts to same-origin useLocalStorage readers. */

import type { NavigationScopeWrite } from "@langwatch/navigation-web/navigation";
import { rememberUiScopeSelection } from "../../../behavior/ui-scope-storage";

export function rememberNavigationScope(write: NavigationScopeWrite): void {
  rememberUiScopeSelection({
    writes: [
      ...(write.organizationId !== void 0
        ? [{ key: "organizationId" as const, value: write.organizationId }]
        : []),
      ...(write.projectSlug !== void 0
        ? [{ key: "projectSlug" as const, value: write.projectSlug }]
        : []),
    ],
  });
}

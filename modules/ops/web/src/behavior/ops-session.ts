/** Reading shape served by host (no probe). scope kept for one branching site;
 * isLoading stays as false for backward compat. */

import { useMemo } from "react";
import { useOpsHost } from "../model/ops-host.ts";

export type OpsScope = { kind: "none" } | { kind: "platform" };

export type OpsPermissionReading = {
  hasAccess: boolean;
  scope: OpsScope;
  isLoading: boolean;
};

export function useOpsPermission(): OpsPermissionReading {
  const host = useOpsHost();
  const hasAccess = host.hasOpsAccess();
  return useMemo(
    () => ({
      hasAccess,
      scope: hasAccess ? { kind: "platform" } : { kind: "none" },
      isLoading: false,
    }),
    [hasAccess],
  );
}

/** Whether the reader may see the Backoffice, which is strictly narrower. */
export function useIsOpsAdmin(): boolean {
  return useOpsHost().isOpsAdmin();
}

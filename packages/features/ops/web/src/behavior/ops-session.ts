/**
 * What the Ops surfaces used to get from `~/hooks/useOpsPermission`.
 *
 * The platform hook fired a live `ops.getScope` probe and derived `hasAccess`
 * from the operator scope it answered. Firing a probe is not a screen's
 * business, so what is left here is the READING half, served by the host — and
 * the host answers it from the session capability's platform-tier grants, which
 * is where the same fact already lives (`ops:view` reads, `ops:manage` writes;
 * `packages/features/authz/contract/src/registry.ts`).
 *
 * `scope` is kept because one call site branches on it, and it is the same
 * two-state discriminator the server computes: `{ kind: "platform" }` for an
 * operator and `{ kind: "none" }` for everybody else, which is exactly
 * `hasAccess` said the other way round.
 *
 * `isLoading` is gone as a MEANING rather than as a field: it reported an
 * in-flight probe, and there is no probe any more. It stays in the shape,
 * always false, so no call site changed — every one of them used it to hold a
 * render back, and the page guard now does that above them.
 */

import { useMemo } from "react";
import { useOpsHost } from "../model/ops-host";

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

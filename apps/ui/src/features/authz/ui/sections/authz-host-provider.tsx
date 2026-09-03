/**
 * What the two RBAC screens are mounted inside.
 *
 * Two things go around `/settings/roles` and `/settings/role-bindings`: the
 * tRPC Provider the package's own hooks run on, and the host port that answers
 * for the organization, the reader's grants, the plan tier and the two notices
 * — and nothing else. A screen stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * THE PLAN IS READ WHERE EVERY MOVED SETTINGS FAMILY READS IT.
 * `useUiOrganizationFacts` asks `limits.getUsage` under the key
 * `@trpc/react-query` would have produced, so it lands on the same cache entry
 * as the application's own `useActivePlan` and the settings menu's gate — one
 * request for the document, however many halves of the product want the answer.
 * A feature could not do this for itself: `@tanstack/react-query` is one of the
 * imports ADR-004 seals off from `src/features/*`.
 */

import { AuthzHostProvider } from "@langwatch/authz-web/screens/authz";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { UiAuthzHost } from "../../behavior/authz-host.adapter";

function AuthzHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();
  const { isEnterprise, isPlanLoading } = useUiOrganizationFacts();

  const host = useMemo(
    () =>
      UiAuthzHost.create(
        {
          scope: { organizationId: activeScope.organizationId ?? void 0 },
          plan: { isEnterprise, isLoading: isPlanLoading },
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [activeScope.organizationId, isEnterprise, isPlanLoading, session, feedback],
  );

  return <AuthzHostProvider value={host}>{children}</AuthzHostProvider>;
}

/** Wraps an AuthZ screen in the host its package asks for. */
export function withAuthzHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <AuthzHost>
      <Screen {...props} />
    </AuthzHost>
  );
  Mounted.displayName = `withAuthzHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}

/**
 * What the two RBAC screens are mounted inside.
 *
 * Two things go around `/settings/roles` and `/settings/role-bindings`: the
 * tRPC Provider the package's own hooks run on, and the host port that answers
 * for the organization, the reader's grants, the plan tier and the two notices
 * — and nothing else. A screen stays a screen module.
 *
 * THE PLAN IS READ WHERE EVERY MOVED SETTINGS FAMILY READS IT.
 * `useUiOrganizationFacts` asks `limits.getUsage` under the key
 * `@trpc/react-query` would have produced, so it lands on the same cache entry
 * as the application's own `useActivePlan` and the settings menu's gate — one
 * request for the document, however many halves of the product want the answer.
 * A feature could not do this for itself: `@tanstack/react-query` is one of the
 * imports ADR-004 seals off from `src/features/*`.
 */

import { AuthzHostProvider, type AuthzHostPort } from "@langwatch/authz-web/screens/authz";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";

export function AuthzHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();
  const { isEnterprise, isPlanLoading } = useUiOrganizationFacts();

  const host = useMemo<AuthzHostPort>(
    () => ({
      scope: () => ({ organizationId: activeScope.organizationId ?? void 0 }),
      hasPermission: (permission) => session.hasPermission(permission),
      plan: () => ({ isEnterprise, isLoading: isPlanLoading }),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [activeScope.organizationId, isEnterprise, isPlanLoading, session, feedback],
  );

  return <AuthzHostProvider value={host}>{children}</AuthzHostProvider>;
}

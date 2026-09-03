/**
 * What the two RBAC screens are mounted inside: the tRPC Provider their
 * hooks run on, and the host port for organization, grants, plan and
 * feedback. Plan comes off `useUiOrganizationFacts` — `react-query` is sealed off from features.
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

/**
 * What the governance screens are mounted inside.
 *
 * Two things go around every `/governance/*` page: the tRPC Provider the
 * package's own hooks run on, and the host port that answers for the session,
 * the organization graph, the plan, the address and the feedback. Both are
 * mounted here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it.
 */

import {
  governanceApi,
  GovernanceHostProvider,
  type GovernanceHostPort,
} from "@langwatch/enterprise-governance-web/screens/governance";
import { useMemo, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { resolveGovernanceOrganization } from "../../behavior/governance-organization-lookup";

/**
 * The deployment shape, read once.
 *
 * A composition whose HTML shell carries no configuration is a self-hosted one
 * with no stated base URL rather than a broken one: the install card then shows
 * the endpoint flag with the CLI's own default, which is what it showed before
 * any of this moved.
 */
function readDeployment(): { isSaas: boolean; appBaseUrl: string } {
  try {
    const config = readPublicAppConfig();
    return { isSaas: config.deployment === "saas", appBaseUrl: config.appBaseUrl };
  } catch {
    return { isSaas: false, appBaseUrl: "https://app.langwatch.ai" };
  }
}

export function GovernanceHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const organizationId = scope.organizationId;

  const organizations = governanceApi.organization.getAll.useQuery({ isDemo: false });
  const usage = governanceApi.limits.getUsage.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );

  const reading = route.reading();

  const host = useMemo<GovernanceHostPort>(
    () => ({
      scope: () => scope,
      organizations: () => organizations.data ?? [],
      organization: () =>
        resolveGovernanceOrganization({
          organizationId: scope.organizationId,
          organizations: organizations.data ?? [],
        }),
      hasPermission: (permission) => session.hasPermission(permission),
      isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
      plan: () => ({
        isEnterprise: usage.data?.activePlan.type === "ENTERPRISE",
        isLoading: usage.isLoading,
      }),
      deployment: () => readDeployment(),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      scope,
      organizations.data,
      usage.data,
      usage.isLoading,
      reading,
      session,
      route,
      navigation,
      feedback,
    ],
  );

  return <GovernanceHostProvider value={host}>{children}</GovernanceHostProvider>;
}

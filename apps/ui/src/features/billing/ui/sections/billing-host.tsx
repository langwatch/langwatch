/**
 * What the three billing screens are mounted inside: the tRPC Provider their
 * hooks run on, and the host port for organization, active team, deployment,
 * address and Stripe checkout departure. Team is derived from the active project, not carried on scope.
 */

import {
  billingApi,
  BillingHostProvider,
  type BillingHostOrganization,
  type BillingHostPort,
} from "@langwatch/enterprise-billing-web/screens/billing";
import { useMemo, type ReactNode } from "react";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiLeaveTo } from "../../../../behavior/ui-departure";

function readDeployment(): { isSaaS: boolean; isSettled: boolean } {
  try {
    return { isSaaS: readPublicAppConfig().deployment === "saas", isSettled: true };
  } catch {
    return { isSaaS: false, isSettled: false };
  }
}

/** Where a Stripe checkout returns the reader to. */
function applicationOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export function BillingHost({ children }: { children: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = billingApi.organization.getAll.useQuery({ isDemo: false });

  const organization: BillingHostOrganization | undefined = useMemo(() => {
    const found = (organizations.data ?? []).find(
      (candidate) => candidate.id === scope.organizationId,
    );
    if (!found) return void 0;
    return { id: found.id, name: found.name, pricingModel: found.pricingModel };
  }, [organizations.data, scope.organizationId]);

  const activeTeamId = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const candidate of organizations.data ?? []) {
      for (const team of candidate.teams) {
        if (team.projects.some((project) => project.id === scope.projectId)) return team.id;
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const reading = route.reading();
  const host = useMemo<BillingHostPort>(() => {
    const deployment = readDeployment();
    return {
      organization: () => organization,
      activeTeamId: () => activeTeamId,
      isSaaS: () => deployment.isSaaS,
      isDeploymentSettled: () => deployment.isSettled,
      routeQuery: () => reading.query,
      applicationOrigin: () => applicationOrigin(),
      navigate: (to) => navigation.navigate(to),
      leaveTo: (url) => uiLeaveTo(url),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    };
  }, [organization, activeTeamId, reading, navigation, feedback]);

  return <BillingHostProvider value={host}>{children}</BillingHostProvider>;
}

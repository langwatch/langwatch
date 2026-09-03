/**
 * What the three billing screens are mounted inside.
 *
 * Two things go around `/settings/plans`, `/settings/subscription` and
 * `/settings/usage`: the tRPC Provider the package's own hooks run on, and the
 * host port that answers for the organization, the active team, the deployment,
 * the address and the departure to a Stripe checkout.
 *
 * THE ORGANIZATION COMES OFF THE GRAPH THE SHELL ALREADY HOLDS.
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. `pricingModel` is what this family reads off it — TIERED and
 * SEAT_EVENT price a seat differently, so it decides whether the usage page
 * draws a ceiling at all.
 *
 * THE ACTIVE TEAM IS DERIVED, not carried. `UiActiveScope` holds an
 * organization and a project and no team, and the subscription page needs one
 * so a bought seat lands somewhere usable: the team that OWNS the active
 * project is that team. No project in scope means an organization-wide
 * invitation, which is exactly what the platform page sent when no team
 * resolved.
 *
 * THE DEPLOYMENT IS READ FROM THE DOCUMENT rather than from a query, and a
 * document with no config tag reads as "not yet answered" rather than throwing
 * — which is what the settled pair the port asks for exists to say.
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

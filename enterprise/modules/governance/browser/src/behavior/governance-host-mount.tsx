/**
 * Governance's answer to the port its screens declare: organization graph
 * and plan come from this module's own tRPC reads, everything else projects
 * a `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  GovernanceHostApi,
  GovernanceHostProvider,
  type GovernanceFailureNotice,
  type GovernanceOrganization,
  type GovernanceRouteReading,
  type GovernanceSuccessNotice,
} from "../model/governance-host.ts";
import { governanceApi } from "./governance-api.ts";

/** A stable reference, so a query still loading never re-triggers a memo below it. */
const NO_ORGANIZATIONS: readonly GovernanceOrganization[] = [];

class CapabilityGovernanceHost extends GovernanceHostApi {
  constructor(
    private readonly inputs: {
      orgs: readonly GovernanceOrganization[];
      org: GovernanceOrganization | undefined;
      plan: { isEnterprise: boolean; isLoading: boolean };
      routeReading: GovernanceRouteReading;
      session: UiSession;
      routeCapability: UiRoute;
      navigation: UiNavigation;
      feedback: UiFeedback;
    },
  ) {
    super();
  }

  organizations(): readonly GovernanceOrganization[] {
    return this.inputs.orgs;
  }

  organization(): GovernanceOrganization | undefined {
    return this.inputs.org;
  }

  currentUser() {
    return this.inputs.session.currentUser();
  }

  hasPermission(permission: string): boolean {
    return this.inputs.session.hasPermission(permission);
  }

  isFeatureEnabled(flag: string): boolean {
    return this.inputs.session.isFeatureEnabled(flag);
  }

  featureFlag(flag: string): boolean | undefined {
    return this.inputs.session.featureFlag(flag);
  }

  isSettled(): boolean {
    return this.inputs.session.isSettled();
  }

  plan() {
    return this.inputs.plan;
  }

  route(): GovernanceRouteReading {
    return this.inputs.routeReading;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.inputs.routeCapability.setQuery(next, options);
  }

  navigate(to: string): void {
    this.inputs.navigation.navigate(to);
  }

  succeeded(notice: GovernanceSuccessNotice): void {
    this.inputs.feedback.succeeded(notice);
  }

  failed(failure: GovernanceFailureNotice): void {
    this.inputs.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function GovernanceHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback, navigation, route } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();

  const organizations = governanceApi.organization.getScopeGraph.useQuery(
    {},
    { enabled: !!session.currentUser() },
  );
  const orgs = organizations.data ?? NO_ORGANIZATIONS;

  const org = useMemo(
    () => (organizationId ? orgs.find((candidate) => candidate.id === organizationId) : void 0),
    [orgs, organizationId],
  );

  const activePlan = governanceApi.plan.getActivePlan.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );
  const plan = useMemo(
    () => ({
      isEnterprise: activePlan.data?.type === "ENTERPRISE",
      isLoading: activePlan.isLoading,
    }),
    [activePlan.data, activePlan.isLoading],
  );

  const routeReading = route.reading();

  const host = useMemo(
    () =>
      new CapabilityGovernanceHost({
        orgs,
        org,
        plan,
        routeReading,
        session,
        routeCapability: route,
        navigation,
        feedback,
      }),
    [orgs, org, plan, routeReading, session, route, navigation, feedback],
  );

  return <GovernanceHostProvider value={host}>{children}</GovernanceHostProvider>;
}

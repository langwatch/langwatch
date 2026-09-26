/**
 * Governance's answer to the port its screens declare: organization graph
 * and plan come from this module's own tRPC reads, everything else projects
 * a `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeployment,
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
  type GovernanceDeployment,
  type GovernanceFailureNotice,
  type GovernanceOrganization,
  type GovernanceRouteReading,
  type GovernanceScope,
  type GovernanceSuccessNotice,
} from "../model/governance-host.ts";
import { governanceApi } from "./governance-api.ts";

/** A stable reference, so a query still loading never re-triggers a memo below it. */
const NO_ORGANIZATIONS: readonly GovernanceOrganization[] = [];

class CapabilityGovernanceHost extends GovernanceHostApi {
  constructor(
    private readonly inputs: {
      organizationId: string | null;
      projectId: string | null;
      orgs: readonly GovernanceOrganization[];
      org: GovernanceOrganization | undefined;
      plan: { isEnterprise: boolean; isLoading: boolean };
      deployment: GovernanceDeployment;
      routeReading: GovernanceRouteReading;
      session: UiSession;
      routeCapability: UiRoute;
      navigation: UiNavigation;
      feedback: UiFeedback;
    },
  ) {
    super();
  }

  scope(): GovernanceScope {
    return { organizationId: this.inputs.organizationId, projectId: this.inputs.projectId };
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

  deployment(): GovernanceDeployment {
    return this.inputs.deployment;
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
  const { organizationId, projectId } = useUiScope().activeScope();
  const uiDeployment = useUiDeployment();

  const organizations = governanceApi.organization.getAll.useQuery({ isDemo: false });
  const orgs = organizations.data ?? NO_ORGANIZATIONS;

  const org = useMemo(
    () => (organizationId ? orgs.find((candidate) => candidate.id === organizationId) : void 0),
    [orgs, organizationId],
  );

  const usage = governanceApi.limits.getUsage.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );
  const plan = useMemo(
    () => ({
      isEnterprise: usage.data?.activePlan.type === "ENTERPRISE",
      isLoading: usage.isLoading,
    }),
    [usage.data, usage.isLoading],
  );

  const deployment = useMemo(
    () => ({ isSaas: uiDeployment.isSaaS, appBaseUrl: uiDeployment.appBaseUrl }),
    [uiDeployment.isSaaS, uiDeployment.appBaseUrl],
  );
  const routeReading = route.reading();

  const host = useMemo(
    () =>
      new CapabilityGovernanceHost({
        organizationId,
        projectId,
        orgs,
        org,
        plan,
        deployment,
        routeReading,
        session,
        routeCapability: route,
        navigation,
        feedback,
      }),
    [
      organizationId,
      projectId,
      orgs,
      org,
      plan,
      deployment,
      routeReading,
      session,
      route,
      navigation,
      feedback,
    ],
  );

  return <GovernanceHostProvider value={host}>{children}</GovernanceHostProvider>;
}

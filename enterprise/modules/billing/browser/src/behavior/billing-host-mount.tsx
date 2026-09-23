/**
 * Billing's answer to the port its screens declare: the organization and
 * active team come from this module's own tRPC read, everything else
 * projects a `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeployment,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
} from "@langwatch/browser-host/capabilities";
import { uiLeaveTo } from "@langwatch/browser-host/navigation";
import { useMemo, type ReactNode } from "react";

import {
  BillingHostApi,
  BillingHostProvider,
  type BillingFailureNotice,
  type BillingHostOrganization,
  type BillingSuccessNotice,
} from "../model/billing-host.ts";
import { billingApi } from "./billing-api.ts";

class CapabilityBillingHost extends BillingHostApi {
  private readonly org: BillingHostOrganization | undefined;
  private readonly teamId: string | undefined;
  private readonly query: Readonly<Record<string, string | undefined>>;
  private readonly deploymentIsSaaS: boolean;
  private readonly navigation: UiNavigation;
  private readonly feedback: UiFeedback;

  constructor({
    org,
    teamId,
    query,
    deploymentIsSaaS,
    navigation,
    feedback,
  }: {
    org: BillingHostOrganization | undefined;
    teamId: string | undefined;
    query: Readonly<Record<string, string | undefined>>;
    deploymentIsSaaS: boolean;
    navigation: UiNavigation;
    feedback: UiFeedback;
  }) {
    super();
    this.org = org;
    this.teamId = teamId;
    this.query = query;
    this.deploymentIsSaaS = deploymentIsSaaS;
    this.navigation = navigation;
    this.feedback = feedback;
  }

  organization(): BillingHostOrganization | undefined {
    return this.org;
  }

  activeTeamId(): string | undefined {
    return this.teamId;
  }

  routeQuery(): Readonly<Record<string, string | undefined>> {
    return this.query;
  }

  isSaaS(): boolean {
    return this.deploymentIsSaaS;
  }

  /** Deployment answers synchronously through capabilities, so it is already settled. */
  isDeploymentSettled(): boolean {
    return true;
  }

  navigate(to: string): void {
    this.navigation.navigate(to);
  }

  leaveTo(url: string): void {
    uiLeaveTo(url);
  }

  applicationOrigin(): string {
    return typeof window === "undefined" ? "" : window.location.origin;
  }

  succeeded(notice: BillingSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: BillingFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function BillingHostMount({ children }: { children?: ReactNode }) {
  const { feedback, navigation, route } = useUiCapabilities();
  const { organizationId, projectId } = useUiScope().activeScope();
  const deployment = useUiDeployment();
  const organizations = billingApi.organization.getAll.useQuery({ isDemo: false });

  const org = useMemo<BillingHostOrganization | undefined>(() => {
    const found = (organizations.data ?? []).find((candidate) => candidate.id === organizationId);
    return found ? { id: found.id, name: found.name, pricingModel: found.pricingModel } : void 0;
  }, [organizations.data, organizationId]);

  const teamId = useMemo(() => {
    if (!projectId) return void 0;
    for (const candidate of organizations.data ?? []) {
      for (const team of candidate.teams) {
        if (team.projects.some((project) => project.id === projectId)) return team.id;
      }
    }
    return void 0;
  }, [organizations.data, projectId]);

  const query = route.reading().query;

  const host = useMemo(
    () =>
      new CapabilityBillingHost({
        org,
        teamId,
        query,
        deploymentIsSaaS: deployment.isSaaS,
        navigation,
        feedback,
      }),
    [org, teamId, query, deployment.isSaaS, navigation, feedback],
  );

  return <BillingHostProvider value={host}>{children}</BillingHostProvider>;
}

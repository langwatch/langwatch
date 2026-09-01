/**
 * The reads the gateway screens used to get from `useOrganizationTeamProject`
 * and `useRequiredSession`.
 *
 * The platform hook resolved the active scope AND redirected on it: a reader
 * without a project was bounced to onboarding unless the caller opted out.
 * Landing policy is not a screen's business and does not travel with it, so
 * what is left here is the reading half — the organization the page is about,
 * the project and team the reader is standing in, and what they may do —
 * served by the host.
 *
 * The options object is gone with the redirects it configured. That is the one
 * shape change every call site of this hook carries.
 */

import { useMemo } from "react";
import {
  useGatewayHost,
  type GatewayActor,
  type GatewayOrganization,
  type GatewayPlan,
  type GatewayProject,
  type GatewayTeam,
} from "../model/gateway-host";

export type GatewayScopeReading = {
  organization: GatewayOrganization | undefined;
  project: GatewayProject | undefined;
  team: GatewayTeam | undefined;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permission: string) => boolean;
};

export function useOrganizationTeamProject(): GatewayScopeReading {
  const host = useGatewayHost();
  return useMemo(
    () => ({
      organization: host.organization(),
      project: host.project(),
      team: host.team(),
      hasPermission: (permission: string) => host.hasPermission(permission),
      // The platform hook drew a distinction the gateway screens never used
      // differently: `hasPermission` asked about the active project and
      // `hasAnyPermission` about anywhere in the organization, and every
      // gateway resource is organization-scoped, so both asked the same
      // question. One answer, under both names, so no call site changed.
      hasAnyPermission: (permission: string) => host.hasPermission(permission),
    }),
    [host],
  );
}

/** Who is signed in, for the surfaces that stamp a key with its owner. */
export function useCurrentUser(): GatewayActor | null {
  return useGatewayHost().currentUser();
}

/** Which plan the organization is on, for the enterprise-gated surfaces. */
export function useActivePlan(): GatewayPlan {
  return useGatewayHost().plan();
}

/** What kind of deployment this is, and where its gateway answers. */
export function useGatewayDeployment() {
  return useGatewayHost().deployment();
}

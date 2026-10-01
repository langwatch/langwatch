/**
 * Data Retention's answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  DataRetentionHostApi,
  DataRetentionHostProvider,
  type RetentionAvailableScopes,
  type RetentionFailureNotice,
  type RetentionHostScope,
  type RetentionRouteReading,
  type RetentionSuccessNotice,
} from "../model/data-retention-host.ts";
import { dataRetentionApi } from "./data-retention-api.ts";

/** What the mount reads through borrowed procedures, as main's settings page read it. */
type RetentionHostReadings = {
  availableScopes: RetentionAvailableScopes;
  isPlatformAdmin: boolean;
  isEnterprise: boolean;
};

class CapabilityDataRetentionHost extends DataRetentionHostApi {
  constructor(
    private readonly deps: {
      scope: RetentionHostScope;
      session: UiSession;
      route: UiRoute;
      feedback: UiFeedback;
      readings: RetentionHostReadings;
    },
  ) {
    super();
  }

  scope(): RetentionHostScope {
    return this.deps.scope;
  }

  hasPermission(permission: string): boolean {
    return this.deps.session.hasPermission(permission);
  }

  availableScopes(): RetentionAvailableScopes {
    return this.deps.readings.availableScopes;
  }

  isPlatformAdmin(): boolean {
    return this.deps.readings.isPlatformAdmin;
  }

  isEnterprise(): boolean {
    return this.deps.readings.isEnterprise;
  }

  route(): RetentionRouteReading {
    const reading = this.deps.route.reading();
    return { params: reading.params, query: reading.query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.route.setQuery(next, options);
  }

  succeeded(notice: RetentionSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: RetentionFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function DataRetentionHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback, route } = useUiCapabilities();
  const uiScope = useUiScope();
  const { organizationId, projectId } = uiScope.activeScope();
  const teamId = uiScope.scopeHost()?.team()?.id;
  // The shell's own workspace read, under the same cache key: no second request.
  // The plan is the session-cached tier read, not the monthly usage count.
  const organizations = dataRetentionApi.organization.getScopeGraph.useQuery({});
  const activePlan = dataRetentionApi.plan.getActivePlan.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );
  const admin = dataRetentionApi.user.isAdmin.useQuery({});
  const planType = activePlan.data?.type;
  const isPlatformAdmin = admin.data?.isAdmin ?? false;
  const readings = useMemo((): RetentionHostReadings => {
    const organization = organizations.data?.find((candidate) => candidate.id === organizationId);
    const teams = organization?.teams ?? [];
    return {
      availableScopes: {
        organization: organization ? { id: organization.id, name: organization.name } : null,
        teams: teams.map((team) => ({ id: team.id, name: team.name })),
        projects: teams.flatMap((team) =>
          team.projects.map((project) => ({ id: project.id, name: project.name, teamId: team.id })),
        ),
      },
      isPlatformAdmin,
      isEnterprise: planType === "ENTERPRISE",
    };
  }, [organizations.data, organizationId, isPlatformAdmin, planType]);

  const host = useMemo(
    () =>
      new CapabilityDataRetentionHost({
        scope: {
          organizationId: organizationId ?? void 0,
          teamId,
          projectId: projectId ?? void 0,
        },
        session,
        route,
        feedback,
        readings,
      }),
    [organizationId, teamId, projectId, session, route, feedback, readings],
  );
  return <DataRetentionHostProvider value={host}>{children}</DataRetentionHostProvider>;
}

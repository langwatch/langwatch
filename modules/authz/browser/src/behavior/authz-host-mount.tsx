/**
 * Authz's answer to the port its screens declare: each method projects a
 * `@langwatch/browser-host` host service or the plan it reads itself, so the
 * module mounts it, not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiHostServices,
  useUiScope,
  type UiFeedback,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiDrawerToken } from "@langwatch/browser-host/declarations";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { useLent } from "@langwatch/browser-host/lent";
import { ProjectSwitcherToken } from "@langwatch/project-client";
import type { ProjectSwitcherProps } from "@langwatch/project-contract";
import { Suspense, type ComponentType, type ReactNode } from "react";

import {
  AuthzHostApi,
  AuthzHostProvider,
  type AuthzFailureNotice,
  type AuthzHostScope,
  type AuthzOrganizationStructure,
  type AuthzPlanReading,
  type AuthzRouteReading,
  type AuthzSuccessNotice,
} from "../model/authz-host.ts";
import { authzApi } from "./authz-api.ts";

class HostServiceAuthzHost extends AuthzHostApi {
  constructor(
    private readonly deps: {
      organizationId: string | undefined;
      projectId: string | undefined;
      session: UiSession;
      feedback: UiFeedback;
      plan: AuthzPlanReading;
      structure: AuthzOrganizationStructure;
      route: AuthzRouteReading;
      setQuery: AuthzHostApi["setQuery"];
      openOverlay: <Props>(drawer: UiDrawerToken<Props>, props?: Partial<Props>) => void;
      closeOverlay: () => void;
      Switcher: ComponentType<ProjectSwitcherProps> | undefined;
    },
  ) {
    super();
  }

  scope(): AuthzHostScope {
    return { organizationId: this.deps.organizationId, projectId: this.deps.projectId };
  }

  hasPermission(permission: string): boolean {
    return this.deps.session.hasPermission(permission);
  }

  plan(): AuthzPlanReading {
    return this.deps.plan;
  }

  route(): AuthzRouteReading {
    return this.deps.route;
  }

  organizationStructure(): AuthzOrganizationStructure {
    return this.deps.structure;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.setQuery(next, options);
  }

  openOverlay<Props>(drawer: UiDrawerToken<Props>, props?: Partial<Props>): void {
    this.deps.openOverlay(drawer, props);
  }

  closeOverlay(): void {
    this.deps.closeOverlay();
  }

  succeeded(notice: AuthzSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: AuthzFailureNotice): void {
    this.deps.feedback.failed(failure);
  }

  /** The switcher project lends by token (ARCHITECTURE §10), as the Secrets page header. */
  projectSwitcher(): ReactNode | null {
    const { Switcher } = this.deps;
    if (!Switcher) return null;
    return (
      <Suspense fallback={null}>
        <Switcher />
      </Suspense>
    );
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function AuthzHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback, route } = useUiHostServices();
  const { openDrawer, closeDrawer } = useDrawer();
  const { query } = route.reading();
  const { organizationId, projectId } = useUiScope().activeScope();
  const Switcher = useLent(ProjectSwitcherToken);
  // The plan tier only: the session-cached read, not the monthly usage count.
  const activePlan = authzApi.plan.getActivePlan.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );
  const planType = activePlan.data?.type;
  const plan = { isEnterprise: planType === "ENTERPRISE", isLoading: activePlan.isLoading };
  // The shell's own workspace read, under the same cache key: no second request.
  const organizations = authzApi.organization.getScopeGraph.useQuery(
    {},
    { enabled: !!session.currentUser() },
  );
  const organization = organizations.data?.find((candidate) => candidate.id === organizationId);
  const teams = organization?.teams ?? [];
  const structure = {
    organizationName: organization?.name,
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    projects: teams.flatMap((team) =>
      team.projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        teamId: team.id,
      })),
    ),
  };
  const host = new HostServiceAuthzHost({
    organizationId: organizationId ?? void 0,
    projectId: projectId ?? void 0,
    session,
    feedback,
    plan,
    structure,
    route: { query },
    setQuery: (next, options) => route.setQuery(next, options),
    openOverlay: (drawer, props) => openDrawer(drawer, props),
    closeOverlay: () => closeDrawer(),
    Switcher,
  });
  return <AuthzHostProvider value={host}>{children}</AuthzHostProvider>;
}

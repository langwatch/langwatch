/**
 * Project home's answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import { useUiCapabilities, useUiDeployment } from "@langwatch/browser-host/capabilities";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { useMemo, type ReactNode } from "react";

import { isLangyDemoProject } from "../model/langy/langy-demo-project.ts";
import {
  ProjectHomeHost,
  ProjectHomeHostProvider,
  type ProjectHomeDeployment,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../model/project-home-host.ts";
import { homeApi } from "./home-api.ts";

/** The two Langy grants, and the rollout that reveals it at all. */
const LANGY_VIEW_PERMISSION = "langy:view";
const LANGY_CREATE_PERMISSION = "langy:create";
const LANGY_RELEASE_FLAG = "release_langy_enabled";
/** Main's `OrganizationUserRole.ADMIN`, as team-visibility.rules.ts:2 spells it. */
const ORGANIZATION_ADMIN_ROLE = "ADMIN";

class CapabilityProjectHomeHost extends ProjectHomeHost {
  private readonly project_: ProjectHomeProject | undefined;
  private readonly organization_: ProjectHomeOrganization | undefined;
  private readonly currentUser_: ProjectHomeUser | undefined;
  private readonly isLoading_: boolean;
  private readonly isSettled: boolean;
  private readonly isPartOfTeam: boolean;
  private readonly hasPermissionOf: (permission: string) => boolean;
  private readonly featureFlagOf: (flag: string) => boolean | undefined;
  private readonly isDemoProject: boolean;
  private readonly deployment_: ProjectHomeDeployment;
  private readonly reducedMotion_: boolean;
  private readonly navigateOf: (to: string) => void;
  private readonly returnTo_: string | undefined;

  constructor(options: {
    project: ProjectHomeProject | undefined;
    organization: ProjectHomeOrganization | undefined;
    currentUser: ProjectHomeUser | undefined;
    isLoading: boolean;
    isSettled: boolean;
    isPartOfTeam: boolean;
    hasPermissionOf: (permission: string) => boolean;
    featureFlagOf: (flag: string) => boolean | undefined;
    isDemoProject: boolean;
    deployment: ProjectHomeDeployment;
    reducedMotion: boolean;
    navigateOf: (to: string) => void;
    returnTo: string | undefined;
  }) {
    super();
    this.project_ = options.project;
    this.organization_ = options.organization;
    this.currentUser_ = options.currentUser;
    this.isLoading_ = options.isLoading;
    this.isSettled = options.isSettled;
    this.isPartOfTeam = options.isPartOfTeam;
    this.hasPermissionOf = options.hasPermissionOf;
    this.featureFlagOf = options.featureFlagOf;
    this.isDemoProject = options.isDemoProject;
    this.deployment_ = options.deployment;
    this.reducedMotion_ = options.reducedMotion;
    this.navigateOf = options.navigateOf;
    this.returnTo_ = options.returnTo;
  }

  project(): ProjectHomeProject | undefined {
    return this.project_;
  }

  organization(): ProjectHomeOrganization | undefined {
    return this.organization_;
  }

  currentUser(): ProjectHomeUser | undefined {
    return this.currentUser_;
  }

  isLoading(): boolean {
    return this.isLoading_;
  }

  hasPermission(permission: string): boolean {
    return this.hasPermissionOf(permission);
  }

  /** Main's useShowLangy gate: the flag is asked only of a reader it could reveal Langy to. */
  langyVisibility(): ProjectHomeLangyVisibility {
    const mayRead = this.mayUseLangy(LANGY_VIEW_PERMISSION);
    const flag = mayRead ? this.featureFlagOf(LANGY_RELEASE_FLAG) : false;
    return {
      show: mayRead && flag === true,
      isResolving: !this.isSettled || this.isLoading_ || (mayRead && flag === void 0),
    };
  }

  canAskLangy(): boolean {
    return (
      this.mayUseLangy(LANGY_CREATE_PERMISSION) && this.featureFlagOf(LANGY_RELEASE_FLAG) === true
    );
  }

  private mayUseLangy(permission: string): boolean {
    return this.isPartOfTeam && !this.isDemoProject && this.hasPermissionOf(permission);
  }

  deployment(): ProjectHomeDeployment {
    return this.deployment_;
  }

  reducedMotion(): boolean {
    return this.reducedMotion_;
  }

  navigate(to: string): void {
    this.navigateOf(to);
  }

  override returnTo(): string | undefined {
    return this.returnTo_;
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function ProjectHomeHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route } = useUiCapabilities();
  const returnTo = route.reading().query.return_to;
  const deployment = useUiDeployment();
  const reducedMotion = useReducedMotion();
  const {
    organization: scopeOrg,
    team: scopeTeam,
    project: scopeProject,
    status,
  } = session.snapshot().scope;
  const isSettled = session.isSettled();
  const { organizationRole } = useOrganizationTeamProject();
  // The graph ships only teams the reader may open (organization-visibility.service.ts:256),
  // so a team in scope is main's "own personal project or team member".
  const isPartOfTeam = scopeTeam !== void 0 || organizationRole === ORGANIZATION_ADMIN_ROLE;
  const actor = session.currentUser();
  const projectId = scopeProject?.id;
  const projectName = scopeProject?.name;
  const projectSlug = scopeProject?.slug;
  const organizationId = scopeOrg?.id;
  const organizationName = scopeOrg?.name;
  const actorId = actor?.id;
  const actorName = actor?.name;
  // The scope carries no `firstMessage`; the shell's own graph read does (same cache entry).
  const organizations = homeApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: actorId !== void 0 },
  );
  const firstMessage = organizations.data
    ?.flatMap((organization) => organization.teams)
    .flatMap((team) => team.projects)
    .find((candidate) => candidate.id === projectId)?.firstMessage;

  // Primitive dependencies only, so the host stays the SAME object across
  // renders that carry the same reading — `lazy()` resolved this mount once,
  // and a fresh object every render would remount the whole tree under it.
  const host = useMemo(
    () =>
      new CapabilityProjectHomeHost({
        project:
          projectId !== void 0
            ? { id: projectId, name: projectName ?? "", slug: projectSlug ?? "", firstMessage }
            : void 0,
        organization:
          organizationName !== void 0 && organizationId !== void 0
            ? { id: organizationId, name: organizationName }
            : void 0,
        currentUser: actorId !== void 0 ? { id: actorId, name: actorName ?? null } : void 0,
        isLoading: status === "loading",
        isSettled,
        isPartOfTeam,
        hasPermissionOf: (permission) => session.hasPermission(permission),
        featureFlagOf: (flag) => session.featureFlag(flag),
        isDemoProject: isLangyDemoProject({
          projectSlug,
          demoProjectSlug: deployment.demoProjectSlug,
        }),
        deployment: {
          isSaaS: deployment.isSaaS,
          isDevelopment: deployment.isDevelopment,
          ...(deployment.demoProjectSlug ? { demoProjectSlug: deployment.demoProjectSlug } : {}),
          ...(deployment.appBaseUrl ? { baseHost: deployment.appBaseUrl } : {}),
        },
        reducedMotion,
        navigateOf: (to) => navigation.navigate(to),
        returnTo,
      }),
    [
      projectId,
      projectName,
      projectSlug,
      firstMessage,
      organizationId,
      organizationName,
      actorId,
      actorName,
      status,
      isSettled,
      isPartOfTeam,
      session,
      deployment.isSaaS,
      deployment.isDevelopment,
      deployment.demoProjectSlug,
      deployment.appBaseUrl,
      reducedMotion,
      navigation,
      returnTo,
    ],
  );
  return <ProjectHomeHostProvider value={host}>{children}</ProjectHomeHostProvider>;
}

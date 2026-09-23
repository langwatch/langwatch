/**
 * Project home's answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import { useUiCapabilities, useUiDeployment } from "@langwatch/browser-host/capabilities";
import { isLangyDemoProject, useReducedMotion } from "@langwatch/langy-browser-kit";
import { useMemo, type ReactNode } from "react";

import {
  ProjectHomeHost,
  ProjectHomeHostProvider,
  type ProjectHomeDeployment,
  type ProjectHomeFlagReading,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../model/project-home-host.ts";

/** The two Langy grants, and the rollout that reveals it at all. */
const LANGY_VIEW_PERMISSION = "langy:view";
const LANGY_CREATE_PERMISSION = "langy:create";
const LANGY_RELEASE_FLAG = "release_langy_enabled";

class CapabilityProjectHomeHost extends ProjectHomeHost {
  private readonly project_: ProjectHomeProject | undefined;
  private readonly organization_: ProjectHomeOrganization | undefined;
  private readonly currentUser_: ProjectHomeUser | undefined;
  private readonly isLoading_: boolean;
  private readonly hasPermissionOf: (permission: string) => boolean;
  private readonly featureFlagOf: (flag: string) => boolean | undefined;
  private readonly isDemoProject: boolean;
  private readonly deployment_: ProjectHomeDeployment;
  private readonly reducedMotion_: boolean;
  private readonly navigateOf: (to: string) => void;

  constructor(options: {
    project: ProjectHomeProject | undefined;
    organization: ProjectHomeOrganization | undefined;
    currentUser: ProjectHomeUser | undefined;
    isLoading: boolean;
    hasPermissionOf: (permission: string) => boolean;
    featureFlagOf: (flag: string) => boolean | undefined;
    isDemoProject: boolean;
    deployment: ProjectHomeDeployment;
    reducedMotion: boolean;
    navigateOf: (to: string) => void;
  }) {
    super();
    this.project_ = options.project;
    this.organization_ = options.organization;
    this.currentUser_ = options.currentUser;
    this.isLoading_ = options.isLoading;
    this.hasPermissionOf = options.hasPermissionOf;
    this.featureFlagOf = options.featureFlagOf;
    this.isDemoProject = options.isDemoProject;
    this.deployment_ = options.deployment;
    this.reducedMotion_ = options.reducedMotion;
    this.navigateOf = options.navigateOf;
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

  featureFlag(flag: string): ProjectHomeFlagReading {
    const answer = this.featureFlagOf(flag);
    return { enabled: answer === true, isLoading: answer === void 0 };
  }

  langyVisibility(): ProjectHomeLangyVisibility {
    const flag = this.featureFlagOf(LANGY_RELEASE_FLAG);
    return {
      show: this.hasPermissionOf(LANGY_VIEW_PERMISSION) && flag === true && !this.isDemoProject,
      isResolving: flag === void 0,
    };
  }

  canAskLangy(): boolean {
    return (
      this.hasPermissionOf(LANGY_CREATE_PERMISSION) &&
      this.featureFlagOf(LANGY_RELEASE_FLAG) === true &&
      !this.isDemoProject
    );
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
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function ProjectHomeHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation } = useUiCapabilities();
  const deployment = useUiDeployment();
  const reducedMotion = useReducedMotion();
  const { organization: scopeOrg, project: scopeProject, status } = session.snapshot().scope;
  const actor = session.currentUser();
  const projectId = scopeProject?.id;
  const projectName = scopeProject?.name;
  const projectSlug = scopeProject?.slug;
  const organizationId = scopeOrg?.id;
  const organizationName = scopeOrg?.name;
  const actorId = actor?.id;
  const actorName = actor?.name;

  // Primitive dependencies only, so the host stays the SAME object across
  // renders that carry the same reading — `lazy()` resolved this mount once,
  // and a fresh object every render would remount the whole tree under it.
  const host = useMemo(
    () =>
      new CapabilityProjectHomeHost({
        project:
          projectId !== void 0
            ? { id: projectId, name: projectName ?? "", slug: projectSlug ?? "" }
            : void 0,
        organization:
          organizationName !== void 0 && organizationId !== void 0
            ? { id: organizationId, name: organizationName }
            : void 0,
        currentUser: actorId !== void 0 ? { id: actorId, name: actorName ?? null } : void 0,
        isLoading: status === "loading",
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
        },
        reducedMotion,
        navigateOf: (to) => navigation.navigate(to),
      }),
    [
      projectId,
      projectName,
      projectSlug,
      organizationId,
      organizationName,
      actorId,
      actorName,
      status,
      session,
      deployment.isSaaS,
      deployment.isDevelopment,
      deployment.demoProjectSlug,
      reducedMotion,
      navigation,
    ],
  );
  return <ProjectHomeHostProvider value={host}>{children}</ProjectHomeHostProvider>;
}

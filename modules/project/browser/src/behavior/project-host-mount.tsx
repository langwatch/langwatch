/**
 * Project's answer to the port its settings screen declares: the organization
 * graph comes from this module's own tRPC read, everything else projects a
 * `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */

import { useUiCapabilities, useUiScope } from "@langwatch/browser-host/capabilities";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import { useMemo, type ReactNode } from "react";

import {
  ProjectHostApi,
  ProjectHostProvider,
  type ProjectFailureNotice,
  type ProjectHostOrganization,
  type ProjectHostProject,
  type ProjectSuccessNotice,
} from "../model/project-host.ts";
import { api, type ProjectApiMap } from "./project-api.ts";

/** The graph as the read answers it: richer than the port's own organization. */
type ProjectOrganizationGraph = ProjectApiMap["organization"]["getAll"]["query"]["output"][number];

/** A stable reference, so a query still loading never re-triggers a memo below it. */
const NO_ORGANIZATIONS: readonly ProjectOrganizationGraph[] = [];

class CapabilityProjectHost extends ProjectHostApi {
  private readonly organization_: ProjectHostOrganization | undefined;
  private readonly project_: ProjectHostProject | undefined;
  private readonly hasPermissionOf: (permission: string) => boolean;
  private readonly isFeatureEnabledOf: (flag: string) => boolean;
  private readonly scopeHost: UiScopeHost | undefined;
  private readonly succeededOf: (notice: ProjectSuccessNotice) => void;
  private readonly failedOf: (failure: ProjectFailureNotice) => void;

  constructor(options: {
    organization: ProjectHostOrganization | undefined;
    project: ProjectHostProject | undefined;
    hasPermissionOf: (permission: string) => boolean;
    isFeatureEnabledOf: (flag: string) => boolean;
    scopeHost: UiScopeHost | undefined;
    succeededOf: (notice: ProjectSuccessNotice) => void;
    failedOf: (failure: ProjectFailureNotice) => void;
  }) {
    super();
    this.organization_ = options.organization;
    this.project_ = options.project;
    this.hasPermissionOf = options.hasPermissionOf;
    this.isFeatureEnabledOf = options.isFeatureEnabledOf;
    this.scopeHost = options.scopeHost;
    this.succeededOf = options.succeededOf;
    this.failedOf = options.failedOf;
  }

  organization(): ProjectHostOrganization | undefined {
    return this.organization_;
  }

  project(): ProjectHostProject | undefined {
    return this.project_;
  }

  hasPermission(permission: string): boolean {
    return this.hasPermissionOf(permission);
  }

  isLiteMember(): boolean {
    return this.scopeHost?.organizationRole() === "EXTERNAL";
  }

  isFeatureEnabled(flag: string): boolean {
    return this.isFeatureEnabledOf(flag);
  }

  /** No switcher capability exists, and this port says null is an answer. */
  projectSwitcher(): ReactNode | null {
    return null;
  }

  /** No drawer-opener capability exists here either; a no-op is the honest reading. */
  openOverlay(): void {
    return void 0;
  }

  succeeded(notice: ProjectSuccessNotice): void {
    this.succeededOf(notice);
  }

  failed(failure: ProjectFailureNotice): void {
    this.failedOf(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function ProjectHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const scope = useUiScope();
  const { organizationId, projectId } = scope.activeScope();
  const scopeHost = scope.scopeHost();

  const organizations = api.organization.getAll.useQuery({ isDemo: false });
  const orgs = organizations.data ?? NO_ORGANIZATIONS;

  const organization = useMemo(
    () => (organizationId ? orgs.find((candidate) => candidate.id === organizationId) : void 0),
    [orgs, organizationId],
  );

  const project = useMemo(
    () =>
      projectId === null
        ? void 0
        : orgs
            .flatMap((candidate) => candidate.teams)
            .flatMap((team) => team.projects)
            .find((candidate) => candidate.id === projectId),
    [orgs, projectId],
  );

  const host = useMemo(
    () =>
      new CapabilityProjectHost({
        organization,
        project,
        hasPermissionOf: (permission) => session.hasPermission(permission),
        isFeatureEnabledOf: (flag) => session.isFeatureEnabled(flag),
        scopeHost,
        succeededOf: (notice) => feedback.succeeded(notice),
        failedOf: (notice) => feedback.failed(notice),
      }),
    [organization, project, session, scopeHost, feedback],
  );
  return <ProjectHostProvider value={host}>{children}</ProjectHostProvider>;
}

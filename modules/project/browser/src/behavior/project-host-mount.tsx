/**
 * Project's answer to the port its settings screen declares: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
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

class CapabilityProjectHost extends ProjectHostApi {
  constructor(
    private readonly hasPermissionOf: (permission: string) => boolean,
    private readonly isFeatureEnabledOf: (flag: string) => boolean,
    private readonly scopeHost: UiScopeHost | undefined,
    private readonly succeededOf: (notice: ProjectSuccessNotice) => void,
    private readonly failedOf: (failure: ProjectFailureNotice) => void,
  ) {
    super();
  }

  /**
   * The rich settings row (S3 config, teams) is not a browser-host
   * capability — undefined is the honest reading until a real data source
   * answers it.
   */
  organization(): ProjectHostOrganization | undefined {
    return void 0;
  }

  project(): ProjectHostProject | undefined {
    return void 0;
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
  const scopeHost = useUiScope().scopeHost();
  const host = useMemo(
    () =>
      new CapabilityProjectHost(
        (permission) => session.hasPermission(permission),
        (flag) => session.isFeatureEnabled(flag),
        scopeHost,
        (notice) => feedback.succeeded(notice),
        (notice) => feedback.failed(notice),
      ),
    [session, scopeHost, feedback],
  );
  return <ProjectHostProvider value={host}>{children}</ProjectHostProvider>;
}

/**
 * Dataset's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability. `isLiteMember` reads the scope
 * host's organization role. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import { useMemo, type ReactNode } from "react";

import {
  DatasetHostApi,
  DatasetHostProvider,
  type DatasetCopyTarget,
  type DatasetFailureNotice,
  type DatasetHostProject,
  type DatasetRouteReading,
  type DatasetSuccessNotice,
} from "../model/dataset-host.ts";

class CapabilityDatasetHost extends DatasetHostApi {
  private readonly scopeHost: UiScopeHost | undefined;
  private readonly session: UiSession;
  private readonly uiRoute: UiRoute;
  private readonly navigation: UiNavigation;
  private readonly feedback: UiFeedback;

  constructor({
    scopeHost,
    session,
    uiRoute,
    navigation,
    feedback,
  }: {
    scopeHost: UiScopeHost | undefined;
    session: UiSession;
    uiRoute: UiRoute;
    navigation: UiNavigation;
    feedback: UiFeedback;
  }) {
    super();
    this.scopeHost = scopeHost;
    this.session = session;
    this.uiRoute = uiRoute;
    this.navigation = navigation;
    this.feedback = feedback;
  }

  project(): DatasetHostProject | undefined {
    const project = this.scopeHost?.project();
    return project ? { id: project.id, slug: project.slug, name: project.name } : void 0;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  isLiteMember(): boolean {
    return this.scopeHost?.organizationRole() === "EXTERNAL";
  }

  /** No org-graph capability exists yet; recorded gap, see the handoff. */
  copyTargets(): readonly DatasetCopyTarget[] {
    return [];
  }

  route(): DatasetRouteReading {
    const { params, query } = this.uiRoute.reading();
    return { params, query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.uiRoute.setQuery(next, options);
  }

  navigate(to: string): void {
    this.navigation.navigate(to);
  }

  succeeded(notice: DatasetSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: DatasetFailureNotice): void {
    this.feedback.failed(failure);
  }

  /** Recorded gap: the dedup `WeakSet` lives on a MutationCache this build doesn't wrap. */
  isReportedGlobally(): boolean {
    return false;
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function DatasetHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scopeHost = useUiScope().scopeHost();

  const host = useMemo(
    () => new CapabilityDatasetHost({ scopeHost, session, uiRoute: route, navigation, feedback }),
    [scopeHost, session, route, navigation, feedback],
  );

  return <DatasetHostProvider value={host}>{children}</DatasetHostProvider>;
}

/**
 * Dataset's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability. `isLiteMember` reads the scope
 * host's organization role. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiCopyTargets,
  useUiScope,
  type UiCopyTargets,
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
  private readonly lent: UiCopyTargets;
  private readonly uiRoute: UiRoute;
  private readonly navigation: UiNavigation;
  private readonly feedback: UiFeedback;

  constructor({
    scopeHost,
    session,
    lent,
    uiRoute,
    navigation,
    feedback,
  }: {
    scopeHost: UiScopeHost | undefined;
    session: UiSession;
    lent: UiCopyTargets;
    uiRoute: UiRoute;
    navigation: UiNavigation;
    feedback: UiFeedback;
  }) {
    super();
    this.scopeHost = scopeHost;
    this.session = session;
    this.lent = lent;
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

  /** Main filtered to the projects the reader may create datasets in. */
  copyTargets(): readonly DatasetCopyTarget[] {
    return (this.lent.targets("datasets:create") ?? [])
      .filter((target) => target.mayCreate)
      .map((target) => ({ label: target.label, value: target.projectId }));
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

  succeeded({ title, description, id, undo }: DatasetSuccessNotice): void {
    this.feedback.succeeded({
      title,
      ...(description ? { description } : {}),
      ...(id ? { id } : {}),
      ...(undo ? { action: { label: undo.label, run: undo.perform } } : {}),
    });
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
  const lent = useUiCopyTargets();
  const scopeHost = useUiScope().scopeHost();

  const host = useMemo(
    () =>
      new CapabilityDatasetHost({ scopeHost, session, lent, uiRoute: route, navigation, feedback }),
    [scopeHost, session, lent, route, navigation, feedback],
  );

  return <DatasetHostProvider value={host}>{children}</DatasetHostProvider>;
}

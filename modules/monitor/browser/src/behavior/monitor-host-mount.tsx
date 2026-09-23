/**
 * Monitor's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability. `copyTargets` reads honestly empty:
 * no org-graph capability exists yet. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  MonitorHostApi,
  MonitorHostProvider,
  type MonitorCopyTarget,
  type MonitorFailureNotice,
  type MonitorOverlayRequest,
  type MonitorRouteReading,
  type MonitorScope,
  type MonitorSuccessNotice,
} from "../model/monitor-host.ts";

class CapabilityMonitorHost extends MonitorHostApi {
  private readonly hostScope: MonitorScope;
  private readonly session: UiSession;
  private readonly navigation: UiNavigation;
  private readonly uiRoute: UiRoute;
  private readonly feedback: UiFeedback;

  constructor({
    hostScope,
    session,
    navigation,
    uiRoute,
    feedback,
  }: {
    hostScope: MonitorScope;
    session: UiSession;
    navigation: UiNavigation;
    uiRoute: UiRoute;
    feedback: UiFeedback;
  }) {
    super();
    this.hostScope = hostScope;
    this.session = session;
    this.navigation = navigation;
    this.uiRoute = uiRoute;
    this.feedback = feedback;
  }

  scope(): MonitorScope {
    return this.hostScope;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  /** No org-graph capability exists yet; recorded gap, see the handoff. */
  copyTargets(): readonly MonitorCopyTarget[] {
    return [];
  }

  timeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  route(): MonitorRouteReading {
    const { params, query } = this.uiRoute.reading();
    return { params, query };
  }

  navigate(to: string): void {
    this.navigation.navigate(to);
  }

  openOverlay(request: MonitorOverlayRequest): void {
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.uiRoute.reading().query)) {
      next[key] = key.startsWith("drawer.") ? void 0 : value;
    }
    next["drawer.open"] = request.drawer;
    for (const [key, value] of Object.entries(request.params ?? {})) next[`drawer.${key}`] = value;
    this.uiRoute.setQuery(next);
  }

  succeeded(notice: MonitorSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: MonitorFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function MonitorHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scopeHost = useUiScope().scopeHost();

  const hostScope = useMemo<MonitorScope>(
    () => ({ projectId: scopeHost?.project()?.id, projectSlug: scopeHost?.project()?.slug }),
    [scopeHost],
  );

  const host = useMemo(
    () => new CapabilityMonitorHost({ hostScope, session, navigation, uiRoute: route, feedback }),
    [hostScope, session, navigation, route, feedback],
  );

  return <MonitorHostProvider value={host}>{children}</MonitorHostProvider>;
}

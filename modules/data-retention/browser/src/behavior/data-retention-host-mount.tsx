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

/**
 * No capability carries the reader's writable-scope list or the plan tier
 * yet, so the filter offers nothing and the enterprise gate reads closed.
 */
const NO_AVAILABLE_SCOPES: RetentionAvailableScopes = {
  organization: null,
  teams: [],
  projects: [],
};

class CapabilityDataRetentionHost extends DataRetentionHostApi {
  constructor(
    private readonly deps: {
      scope: RetentionHostScope;
      session: UiSession;
      route: UiRoute;
      feedback: UiFeedback;
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
    return NO_AVAILABLE_SCOPES;
  }

  isPlatformAdmin(): boolean {
    return false;
  }

  isEnterprise(): boolean {
    return false;
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
      }),
    [organizationId, teamId, projectId, session, route, feedback],
  );
  return <DataRetentionHostProvider value={host}>{children}</DataRetentionHostProvider>;
}

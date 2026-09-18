/**
 * Data Privacy's answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiRoute,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  DataPrivacyHostApi,
  DataPrivacyHostProvider,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "../model/data-privacy-host.ts";

class CapabilityDataPrivacyHost extends DataPrivacyHostApi {
  constructor(
    private readonly deps: { scope: PrivacyHostScope; route: UiRoute; feedback: UiFeedback },
  ) {
    super();
  }

  scope(): PrivacyHostScope {
    return this.deps.scope;
  }

  route(): PrivacyRouteReading {
    const reading = this.deps.route.reading();
    return { params: reading.params, query: reading.query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.route.setQuery(next, options);
  }

  succeeded(notice: PrivacySuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: PrivacyFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function DataPrivacyHostMount({ children }: { children?: ReactNode }) {
  const { feedback, route } = useUiCapabilities();
  const uiScope = useUiScope();
  const { organizationId, projectId } = uiScope.activeScope();
  const teamId = uiScope.scopeHost()?.team()?.id;

  const host = useMemo(
    () =>
      new CapabilityDataPrivacyHost({
        scope: {
          organizationId: organizationId ?? void 0,
          teamId,
          projectId: projectId ?? void 0,
        },
        route,
        feedback,
      }),
    [organizationId, teamId, projectId, route, feedback],
  );
  return <DataPrivacyHostProvider value={host}>{children}</DataPrivacyHostProvider>;
}

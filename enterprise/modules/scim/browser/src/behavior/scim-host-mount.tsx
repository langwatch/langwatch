/**
 * SCIM's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` host service. ARCHITECTURE.md §10.1.
 */

import {
  useUiHostServices,
  useUiDeployment,
  useUiScope,
  type UiFeedback,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { ReleaseFlagToken } from "@langwatch/browser-host/declarations";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { useUiFlags, type UiFlags } from "@langwatch/browser-host/feature-flag";
import { useMemo, type ReactNode } from "react";

import {
  ScimHostApi,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimRouteReading,
  type ScimSuccessNotice,
} from "../model/scim-host.ts";

class HostServiceScimHost extends ScimHostApi {
  private readonly orgId: string | undefined;
  private readonly appBaseUrl: string;
  private readonly feedback: UiFeedback;
  private readonly uiRoute: UiRoute;
  private readonly session: UiSession;
  private readonly flags: UiFlags;
  private readonly closeDrawer: () => void;

  constructor({
    orgId,
    appBaseUrl,
    feedback,
    uiRoute,
    session,
    flags,
    closeDrawer,
  }: {
    orgId: string | undefined;
    appBaseUrl: string;
    feedback: UiFeedback;
    uiRoute: UiRoute;
    session: UiSession;
    flags: UiFlags;
    closeDrawer: () => void;
  }) {
    super();
    this.orgId = orgId;
    this.appBaseUrl = appBaseUrl;
    this.feedback = feedback;
    this.uiRoute = uiRoute;
    this.session = session;
    this.flags = flags;
    this.closeDrawer = closeDrawer;
  }

  closeOverlay(): void {
    this.closeDrawer();
  }

  organizationId(): string | undefined {
    return this.orgId;
  }

  /** The address an identity provider posts SCIM requests to. */
  scimBaseUrl(): string {
    return `${this.appBaseUrl}/api/scim/v2`;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  isFeatureEnabled(flag: ReleaseFlagToken): boolean {
    return this.flags.flag(flag) === true;
  }

  succeeded(notice: ScimSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: ScimFailureNotice): void {
    this.feedback.failed(failure);
  }

  route(): ScimRouteReading {
    return { query: this.uiRoute.reading().query };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.uiRoute.setQuery(next, { replace: true });
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function ScimHostMount({ children }: { children?: ReactNode }) {
  const { feedback, route, session } = useUiHostServices();
  const flags = useUiFlags();
  const { organizationId } = useUiScope().activeScope();
  const { appBaseUrl } = useUiDeployment();
  const { closeDrawer } = useDrawer();

  const host = useMemo(
    () =>
      new HostServiceScimHost({
        orgId: organizationId ?? void 0,
        appBaseUrl,
        feedback,
        uiRoute: route,
        session,
        flags,
        closeDrawer,
      }),
    [organizationId, appBaseUrl, feedback, route, session, flags, closeDrawer],
  );

  return <ScimHostProvider value={host}>{children}</ScimHostProvider>;
}

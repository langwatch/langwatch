/**
 * SCIM's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeployment,
  useUiScope,
  type UiFeedback,
  type UiRoute,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  ScimHostApi,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimRouteReading,
  type ScimSuccessNotice,
} from "../model/scim-host.ts";

class CapabilityScimHost extends ScimHostApi {
  constructor(
    private readonly orgId: string | undefined,
    private readonly appBaseUrl: string,
    private readonly feedback: UiFeedback,
    private readonly uiRoute: UiRoute,
  ) {
    super();
  }

  organizationId(): string | undefined {
    return this.orgId;
  }

  /** The address an identity provider posts SCIM requests to. */
  scimBaseUrl(): string {
    return `${this.appBaseUrl}/api/scim/v2`;
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
  const { feedback, route } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();
  const { appBaseUrl } = useUiDeployment();

  const host = useMemo(
    () => new CapabilityScimHost(organizationId ?? void 0, appBaseUrl, feedback, route),
    [organizationId, appBaseUrl, feedback, route],
  );

  return <ScimHostProvider value={host}>{children}</ScimHostProvider>;
}

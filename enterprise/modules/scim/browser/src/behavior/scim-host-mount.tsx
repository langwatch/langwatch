/**
 * SCIM's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeployment,
  useUiScope,
  type UiFeedback,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  ScimHostApi,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimSuccessNotice,
} from "../model/scim-host.ts";

class CapabilityScimHost extends ScimHostApi {
  constructor(
    private readonly orgId: string | undefined,
    private readonly appBaseUrl: string,
    private readonly feedback: UiFeedback,
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
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function ScimHostMount({ children }: { children?: ReactNode }) {
  const { feedback } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();
  const { appBaseUrl } = useUiDeployment();

  const host = useMemo(
    () => new CapabilityScimHost(organizationId ?? void 0, appBaseUrl, feedback),
    [organizationId, appBaseUrl, feedback],
  );

  return <ScimHostProvider value={host}>{children}</ScimHostProvider>;
}

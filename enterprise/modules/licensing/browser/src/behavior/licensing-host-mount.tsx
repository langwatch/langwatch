/**
 * Licensing's answer to the port its screen declares. The purchase link has no
 * capability to come from yet, so it is undefined, which the port already
 * allows — a module may not read the shell's injected config itself.
 */

import {
  useUiCapabilities,
  useUiDeployment,
  useUiScope,
  type UiFeedback,
} from "@langwatch/browser-host/capabilities";
import { describeError } from "@langwatch/browser-host/errors";
import { useMemo, type ReactNode } from "react";

import {
  LicensingHostApi,
  LicensingHostProvider,
  type LicensingFailureNotice,
  type LicensingSuccessNotice,
} from "../model/licensing-host.ts";
import { licensingApi } from "./licensing-api.ts";

class CapabilityLicensingHost extends LicensingHostApi {
  constructor(
    private readonly orgId: string | undefined,
    private readonly deploymentIsSaaS: boolean,
    private readonly purchaseUrl: string | undefined,
    private readonly invalidate: () => void,
    private readonly feedback: UiFeedback,
    private readonly mayManageOrganization: boolean,
  ) {
    super();
  }

  organizationId(): string | undefined {
    return this.orgId;
  }

  isSaaS(): boolean {
    return this.deploymentIsSaaS;
  }

  /** Deployment answers synchronously through capabilities, so it is already settled. */
  isDeploymentSettled(): boolean {
    return true;
  }

  licensePurchaseUrl(): string | undefined {
    return this.purchaseUrl;
  }

  refreshPlanDerivedState(): void {
    this.invalidate();
  }

  succeeded(notice: LicensingSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: LicensingFailureNotice): void {
    this.feedback.failed(failure);
  }

  canManageOrganization(): boolean {
    return this.mayManageOrganization;
  }

  describeFailure(failure: LicensingFailureNotice): string {
    return describeError(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function LicensingHostMount({ children }: { children?: ReactNode }) {
  const { feedback, session } = useUiCapabilities();
  const mayManageOrganization = session.hasPermission("organization:manage");
  const { organizationId } = useUiScope().activeScope();
  const deployment = useUiDeployment();
  const utils = licensingApi.useUtils();

  const host = useMemo(
    () =>
      new CapabilityLicensingHost(
        organizationId ?? void 0,
        deployment.isSaaS,
        void 0,
        () => void utils.invalidate(),
        feedback,
        mayManageOrganization,
      ),
    [organizationId, deployment.isSaaS, utils, feedback, mayManageOrganization],
  );

  return <LicensingHostProvider value={host}>{children}</LicensingHostProvider>;
}

import {
  UiHostServiceUnavailableError,
  type UiSession,
  useUiHostServices,
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
import { GlobalUpgradeModal } from "../ui/sections/global-upgrade-modal/global-upgrade-modal.tsx";
import { licensingApi } from "./licensing-api.ts";

class CapabilityLicensingHost extends LicensingHostApi {
  private readonly orgId: string | undefined;
  private readonly deploymentIsSaaS: boolean;
  private readonly purchaseUrl: string | undefined;
  private readonly invalidate: () => void;
  private readonly feedback: UiFeedback;
  private readonly mayManageOrganization: boolean;

  constructor({
    orgId,
    deploymentIsSaaS,
    purchaseUrl,
    invalidate,
    feedback,
    mayManageOrganization,
  }: {
    orgId: string | undefined;
    deploymentIsSaaS: boolean;
    purchaseUrl: string | undefined;
    invalidate: () => void;
    feedback: UiFeedback;
    mayManageOrganization: boolean;
  }) {
    super();
    this.orgId = orgId;
    this.deploymentIsSaaS = deploymentIsSaaS;
    this.purchaseUrl = purchaseUrl;
    this.invalidate = invalidate;
    this.feedback = feedback;
    this.mayManageOrganization = mayManageOrganization;
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

  warned(notice: LicensingSuccessNotice): void {
    this.feedback.warned(notice);
  }

  informed(notice: LicensingSuccessNotice): void {
    this.feedback.informed(notice);
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
 * Whether the reader manages the active organization. Asked at the organization, not at the
 * active project, where an organization admin can read as "no"; a session port that cannot
 * answer at the organization falls back to its scope-wide answer.
 */
export function managesOrganization(session: UiSession): boolean {
  try {
    return session.hasOrganizationPermission("organization:manage");
  } catch (error) {
    if (!(error instanceof UiHostServiceUnavailableError)) throw error;
    return session.hasPermission("organization:manage");
  }
}

/**
 * The declared mount: one provider above the routed tree, plus the store-driven upgrade
 * dialog every routed page opens. Default-exported because `mounts.load` resolves it.
 */
export default function LicensingHostMount({ children }: { children?: ReactNode }) {
  const { feedback, session } = useUiHostServices();
  const mayManageOrganization = managesOrganization(session);
  const { organizationId } = useUiScope().activeScope();
  const deployment = useUiDeployment();
  const utils = licensingApi.useUtils();

  const host = useMemo(
    () =>
      new CapabilityLicensingHost({
        orgId: organizationId ?? void 0,
        deploymentIsSaaS: deployment.isSaaS,
        purchaseUrl: deployment.licensePaymentUrl,
        invalidate: () => void utils.invalidate(),
        feedback,
        mayManageOrganization,
      }),
    [
      organizationId,
      deployment.isSaaS,
      deployment.licensePaymentUrl,
      utils,
      feedback,
      mayManageOrganization,
    ],
  );

  return (
    <LicensingHostProvider value={host}>
      {children}
      <GlobalUpgradeModal isSaaS={deployment.isSaaS} isAdmin={mayManageOrganization} />
    </LicensingHostProvider>
  );
}

/**
 * What the License screen is mounted inside: the tRPC Provider its hooks
 * run on, and the host port for organization, deployment, purchase link,
 * cache drop and feedback. `refreshPlanDerivedState` drops every cached read, deliberately, replacing a full-page reload.
 */

import {
  licensingApi,
  LicensingHostProvider,
  type LicensingHostPort,
} from "@langwatch/enterprise-licensing-web/screens/license";
import { useMemo, type ReactNode } from "react";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

/** The deployment and its purchase link: no config reads as unknown here, not a crash — right for a settings page, wrong for a boot boundary. */
function readDeployment(): { isSaaS: boolean; isSettled: boolean; purchaseUrl?: string } {
  try {
    const config = readPublicAppConfig();
    return {
      isSaaS: config.deployment === "saas",
      isSettled: true,
      ...(config.licensePaymentUrl ? { purchaseUrl: config.licensePaymentUrl } : {}),
    };
  } catch {
    return { isSaaS: false, isSettled: false };
  }
}

export function LicensingHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { organizationId } = session.activeScope();
  const utils = licensingApi.useUtils();

  const host = useMemo<LicensingHostPort>(() => {
    const deployment = readDeployment();
    return {
      organizationId: () => organizationId ?? void 0,
      isSaaS: () => deployment.isSaaS,
      isDeploymentSettled: () => deployment.isSettled,
      licensePurchaseUrl: () => deployment.purchaseUrl,
      refreshPlanDerivedState: () => void utils.invalidate(),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    };
  }, [organizationId, feedback, utils]);

  return <LicensingHostProvider value={host}>{children}</LicensingHostProvider>;
}

export { licensingApi };

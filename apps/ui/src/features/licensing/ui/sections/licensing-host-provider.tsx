/**
 * What the License screen is mounted inside.
 *
 * Two things go around `/settings/license`: the tRPC Provider the package's own
 * hooks run on, and the host port that answers for the organization, the
 * deployment, the purchase link, the cache drop and the two notices.
 *
 * THE DEPLOYMENT IS READ FROM THE DOCUMENT, not from a query. `platform/app`
 * asked `usePublicEnv`, which is a round trip; this application declares its
 * whole public configuration in a meta tag at boot, so the answer is available
 * on the first frame — and a document with NO tag reads as "unknown deployment"
 * rather than throwing, which is what the settled pair the port asks for is
 * built to say.
 *
 * `refreshPlanDerivedState` DROPS EVERY CACHED READ, deliberately. Activating
 * or removing a license moves the active plan, which the navigation, the
 * feature gates and the limit copy all read; the blunt instrument is what
 * replaced a `window.location.reload()` that tore the operator's one
 * instruction off the screen.
 */

import {
  licensingApi,
  LicensingHostProvider,
} from "@langwatch/enterprise-licensing-web/screens/license";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiLicensingHost } from "../../behavior/licensing-host.adapter";

/**
 * The deployment and its purchase link, as the document declares them.
 *
 * A composition whose HTML shell carries no config is an unknown deployment
 * here rather than a crash: the application's own reader throws, which is right
 * for a boot boundary and wrong for a settings page mounted in a test.
 */
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

function LicensingHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { organizationId } = session.activeScope();
  const utils = licensingApi.useUtils();

  const host = useMemo(() => {
    const deployment = readDeployment();
    return UiLicensingHost.create(
      {
        organizationId: organizationId ?? void 0,
        isSaaS: deployment.isSaaS,
        isDeploymentSettled: deployment.isSettled,
        licensePurchaseUrl: deployment.purchaseUrl,
      },
      {
        refreshPlanDerivedState: () => void utils.invalidate(),
        succeeded: (notice) => feedback.succeeded(notice),
        failed: (failure) => feedback.failed(failure),
      },
    );
  }, [organizationId, feedback, utils]);

  return <LicensingHostProvider value={host}>{children}</LicensingHostProvider>;
}

/** Wraps the License screen in the host its package asks for. */
export function withLicensingHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <LicensingHost>
      <Screen {...props} />
    </LicensingHost>
  );
  Mounted.displayName = `withLicensingHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}

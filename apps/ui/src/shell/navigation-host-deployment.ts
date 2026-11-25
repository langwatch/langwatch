/**
 * What kind of deployment the chrome is drawn on: the shell's published
 * deployment, read off the installed modules' config, plus the process's
 * two development-badge facts.
 */

import type { UiDeployment } from "@langwatch/browser-host/capabilities";
import type { ProcessWebConfig } from "@langwatch/config/public-app-config";
import type { NavigationDeployment } from "@langwatch/navigation-contract";

type DevIndicator = Pick<ProcessWebConfig, "hideDevIndicator" | "devIndicatorLabel">;

export function navigationDeploymentOf({
  deployment,
  process: { hideDevIndicator, devIndicatorLabel },
}: {
  deployment: UiDeployment;
  process: DevIndicator;
}): NavigationDeployment {
  return {
    isSaaS: deployment.isSaaS,
    hasCloudOps: deployment.hasCloudOps,
    isDevelopment: deployment.isDevelopment,
    ...(hideDevIndicator ? { hideDevIndicator: true } : {}),
    ...(devIndicatorLabel ? { devIndicatorLabel } : {}),
    ...(deployment.demoProjectSlug ? { demoProjectSlug: deployment.demoProjectSlug } : {}),
    hasNlpService: deployment.hasNlpService,
    hasLangevals: deployment.hasLangevals,
  };
}

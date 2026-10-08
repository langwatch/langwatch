/**
 * What kind of deployment the chrome is drawn on: the shell's published
 * deployment, read off the installed modules' config, plus the process's
 * two development-badge facts.
 */

import type { UiDeployment } from "@langwatch/browser-host/capabilities";
import { readPublicAppConfig } from "@langwatch/browser/public-config";
import { readUiProcessConfig } from "@langwatch/browser/supply";
import type { ProcessWebConfig } from "@langwatch/config/public-app-config";
import type { NavigationDeployment } from "@langwatch/navigation-contract";

type DevIndicator = Pick<ProcessWebConfig, "hideDevIndicator" | "devIndicatorLabel">;

/** Interim document read until the chrome is handed the process slice (handoff §12). */
function readDevIndicator(): DevIndicator {
  try {
    const { hideDevIndicator, devIndicatorLabel } = readUiProcessConfig(readPublicAppConfig());
    return { hideDevIndicator, devIndicatorLabel };
  } catch {
    return {};
  }
}

export function navigationDeploymentOf(deployment: UiDeployment): NavigationDeployment {
  const { hideDevIndicator, devIndicatorLabel } = readDevIndicator();
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

/**
 * What kind of deployment the chrome is drawn on. Only the composing
 * application can read this, which is why the port asks for it rather than
 * a browser package decoding the shell's meta tag a fourth time.
 */

import type { NavigationDeployment } from "@langwatch/navigation-browser/navigation";
import { readPublicAppConfig } from "@langwatch/ui-kernel/public-config";

import { parseUiFeatureConfig } from "../ui-feature-config";

/**
 * A document with no config makes no claim about the analysis services, and
 * warning that two settings are unset on the strength of a missing config
 * block would be a false alarm on every test mount.
 */
const UNCONFIGURED: NavigationDeployment = {
  isSaaS: false,
  hasCloudOps: false,
  isDevelopment: false,
  hasNlpService: true,
  hasLangevals: true,
};

export function readNavigationDeployment(): NavigationDeployment {
  try {
    const { process, authz, evaluation, ops } = parseUiFeatureConfig(readPublicAppConfig());
    return {
      isSaaS: process.deployment === "saas",
      hasCloudOps: ops.cloudOps,
      isDevelopment: process.mode === "development",
      ...(process.hideDevIndicator ? { hideDevIndicator: true } : {}),
      ...(process.devIndicatorLabel ? { devIndicatorLabel: process.devIndicatorLabel } : {}),
      ...authz,
      hasNlpService: process.nlp,
      hasLangevals: evaluation.langevals,
    };
  } catch {
    return UNCONFIGURED;
  }
}

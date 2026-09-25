/**
 * The one reading of the page's config slices into the deployment capability,
 * so a module never reads the meta tag itself — a host reaching past this is
 * the side door §3.4 shut.
 */

import type { ProcessWebConfig } from "@langwatch/config/public-app-config";

import type { UiDeployment } from "./capabilities.ts";

/** The validated slices the shell read, and the page origin for an address the process left out. */
export type UiDeploymentSlices = Readonly<{
  process: ProcessWebConfig;
  origin: string;
  demoProjectSlug?: string;
  licensePaymentUrl?: string;
  hasLangevals: boolean;
  hasEmailProvider: boolean;
  authProvider?: string;
  passkeysEnabled: boolean;
}>;

export function deriveUiDeployment({
  process,
  origin,
  demoProjectSlug,
  licensePaymentUrl,
  hasLangevals,
  hasEmailProvider,
  authProvider,
  passkeysEnabled,
}: UiDeploymentSlices): UiDeployment {
  return {
    isDevelopment: process.mode === "development",
    isSaaS: process.deployment === "saas",
    appBaseUrl: process.appBaseUrl ?? origin,
    ...(demoProjectSlug ? { demoProjectSlug } : {}),
    ...(licensePaymentUrl ? { licensePaymentUrl } : {}),
    hasNlpService: process.nlp,
    hasLangevals,
    hasEmailProvider,
    ...(authProvider ? { authProvider } : {}),
    passkeysEnabled,
  };
}

/**
 * The one decoder off the injected public config, so a module never reads the
 * meta tag itself — a host reaching past this is the side door §3.4 shut.
 */

import type { PublicAppConfig } from "@langwatch/config/public-app-config";

import type { UiDeployment } from "./capabilities.ts";

export function deriveUiDeployment(config: PublicAppConfig): UiDeployment {
  return {
    isDevelopment: config.mode === "development",
    isSaaS: config.deployment === "saas",
    appBaseUrl: config.appBaseUrl,
    ...(config.demoProjectSlug ? { demoProjectSlug: config.demoProjectSlug } : {}),
    ...(config.licensePaymentUrl ? { licensePaymentUrl: config.licensePaymentUrl } : {}),
    hasNlpService: config.capabilities.nlp,
    hasLangevals: config.capabilities.langevals,
    hasEmailProvider: config.capabilities.email,
  };
}

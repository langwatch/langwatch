/**
 * The one decoder for `isSaaS`, `demoProjectSlug`, `hasNlpService` and
 * `hasLangevals` off the injected public config, so a module never
 * hand-rolls the meta tag itself for them. Record 10.1.
 */

import type { PublicAppConfig } from "@langwatch/config/public-app-config";

import type { UiDeployment } from "./capabilities.ts";

export function deriveUiDeployment(config: PublicAppConfig): UiDeployment {
  return {
    isDevelopment: config.mode === "development",
    isSaaS: config.deployment === "saas",
    ...(config.demoProjectSlug ? { demoProjectSlug: config.demoProjectSlug } : {}),
    hasNlpService: config.capabilities.nlp,
    hasLangevals: config.capabilities.langevals,
  };
}

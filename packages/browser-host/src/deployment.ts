/**
 * The one reading of the page's config slices into the deployment host service,
 * so a module never reads the meta tag itself — a host reaching past this is
 * the side door §3.4 shut.
 */

import type { ProcessWebConfig } from "@langwatch/config/public-app-config";

import type { UiDeployment } from "./capabilities.ts";

/** The validated slices the shell read, and the page origin for an address the process left out. */
export type UiDeploymentSlices = Readonly<{
  process: ProcessWebConfig;
  origin: string;
  /** The public URL auth signs readers in on; beats an in-cluster BASE_HOST. */
  publicUrl?: string;
  demoProjectSlug?: string;
  licensePaymentUrl?: string;
  hasLangevals: boolean;
  hasEmailProvider: boolean;
  authProvider?: string;
  passkeysEnabled: boolean;
  emailPasswordEnabled: boolean;
  federatedProviders: readonly string[];
  signUpMode?: "open" | "invite_only";
  hasCloudOps: boolean;
  gatewayBaseUrl?: string;
}>;

export function deriveUiDeployment({
  process,
  origin,
  publicUrl,
  demoProjectSlug,
  licensePaymentUrl,
  hasLangevals,
  hasEmailProvider,
  authProvider,
  passkeysEnabled,
  emailPasswordEnabled,
  federatedProviders,
  signUpMode,
  hasCloudOps,
  gatewayBaseUrl,
}: UiDeploymentSlices): UiDeployment {
  return {
    isDevelopment: process.mode === "development",
    isSaaS: process.deployment === "saas",
    appBaseUrl: publicUrl || process.appBaseUrl || origin,
    ...(demoProjectSlug ? { demoProjectSlug } : {}),
    ...(licensePaymentUrl ? { licensePaymentUrl } : {}),
    hasNlpService: process.nlp,
    hasLangevals,
    hasEmailProvider,
    ...(authProvider ? { authProvider } : {}),
    passkeysEnabled,
    emailPasswordEnabled,
    federatedProviders,
    ...(signUpMode ? { signUpMode } : {}),
    hasCloudOps,
    ...(gatewayBaseUrl ? { gatewayBaseUrl } : {}),
  };
}

/** Where the app runs: LangWatch's cloud, a customer's own install, or a developer's machine. */
export type Hosting = "cloud" | "self-hosted" | "local";

/** A development build is local whatever it claims to be; haven stacks run SaaS-shaped. */
export function hostingOf({
  isDevelopment,
  isSaaS,
}: Pick<UiDeployment, "isDevelopment" | "isSaaS">): Hosting {
  if (isDevelopment) return "local";
  return isSaaS ? "cloud" : "self-hosted";
}
